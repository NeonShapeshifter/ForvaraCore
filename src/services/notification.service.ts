import { v4 as uuidv4 } from 'uuid';
import webpush from 'web-push';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';
import { 
  Notification,
  NotificationPreferences,
  PushSubscription,
  NotificationChannel,
  PaginatedResponse
} from '../types';
import { websocketService } from './websocket.service';
import { addEmailJob, addNotificationJob } from '../queues';
import { SOCKET_EVENTS } from '../constants';

// Configurar Web Push (deshabilitado temporalmente para desarrollo)
if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    'mailto:notifications@forvara.com',
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY
  );
}

// Lazy initialization - se inicializarán cuando se usen
let supabaseInstance: any;
let redisInstance: any;

const getSupabaseInstance = () => {
  if (!supabaseInstance) {
    supabaseInstance = getSupabase();
  }
  return supabaseInstance;
};

const getRedisInstance = () => {
  if (!redisInstance) {
    redisInstance = getRedis();
  }
  return redisInstance;
};

class NotificationService {
  /**
   * Crear notificación
   */
  async create(notification: Omit<Notification, 'id' | 'created_at'>): Promise<Notification> {
    try {
      const notificationId = uuidv4();

      // Guardar en base de datos
      const { data: created, error } = await supabase
        .from('notifications')
        .insert({
          id: notificationId,
          ...notification,
          read: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Obtener preferencias del usuario
      const preferences = await this.getUserPreferences(notification.user_id);

      // Determinar canales de notificación
      const channels = this.determineChannels(notification, preferences);

      // Enviar por los canales habilitados
      if (channels.includes('in-app')) {
        // WebSocket para notificación en tiempo real
        websocketService.sendToUser(
          notification.user_id,
          SOCKET_EVENTS.NEW_NOTIFICATION,
          created
        );

        // Incrementar contador en cache
        await this.incrementUnreadCount(notification.user_id);
      }

      if (channels.includes('push')) {
        await this.sendPushNotification(notification.user_id, notification);
      }

      if (channels.includes('email') && preferences.email_enabled) {
        await addEmailJob({
          to: preferences.email!,
          subject: notification.title,
          template: 'notification',
          data: {
            title: notification.title,
            message: notification.message,
            actionUrl: notification.action_url
          }
        });
      }

      if (channels.includes('sms') && preferences.sms_enabled) {
        await this.sendSMSNotification(notification.user_id, notification);
      }

      logger.info({ 
        notificationId, 
        userId: notification.user_id,
        type: notification.type,
        channels 
      }, 'Notification created');

      return created;
    } catch (error) {
      logger.error({ error, notification }, 'Create notification failed');
      throw error;
    }
  }

  /**
   * Obtener notificaciones del usuario
   */
  async getUserNotifications(
    userId: string,
    options: {
      read?: boolean;
      type?: string;
      priority?: string;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<PaginatedResponse<Notification>> {
    try {
      const { read, type, priority, page = 1, limit = 20 } = options;

      let query = supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      // Filtros
      if (typeof read === 'boolean') {
        query = query.eq('read', read);
      }

      if (type) {
        query = query.eq('type', type);
      }

      if (priority) {
        query = query.eq('priority', priority);
      }

      // Paginación
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, userId }, 'Get user notifications failed');
      throw error;
    }
  }

  /**
   * Marcar notificación como leída
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ 
          read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId)
        .eq('user_id', userId);

      if (error) throw error;

      // Actualizar contador en cache
      await this.decrementUnreadCount(userId);

      // Notificar actualización en tiempo real
      websocketService.sendToUser(
        userId,
        SOCKET_EVENTS.NOTIFICATION_READ,
        { notificationId }
      );

      logger.info({ notificationId, userId }, 'Notification marked as read');
    } catch (error) {
      logger.error({ error, notificationId }, 'Mark as read failed');
      throw error;
    }
  }

  /**
   * Marcar todas como leídas
   */
  async markAllAsRead(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ 
          read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;

      // Resetear contador
      await redis.del(`notifications:unread:${userId}`);

      // Notificar actualización
      websocketService.sendToUser(
        userId,
        SOCKET_EVENTS.ALL_NOTIFICATIONS_READ,
        {}
      );

      logger.info({ userId }, 'All notifications marked as read');
    } catch (error) {
      logger.error({ error, userId }, 'Mark all as read failed');
      throw error;
    }
  }

  /**
   * Obtener contadores
   */
  async getUnreadCount(userId: string): Promise<number> {
    // Intentar obtener de cache primero
    const cached = await redis.get(`notifications:unread:${userId}`);
    if (cached !== null) {
      return parseInt(cached);
    }

    // Si no está en cache, consultar BD
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);

    const unreadCount = count || 0;

    // Guardar en cache
    await redis.setex(`notifications:unread:${userId}`, 3600, unreadCount);

    return unreadCount;
  }

  /**
   * Actualizar preferencias
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    try {
      const { data: updated, error } = await supabase
        .from('notification_preferences')
        .upsert({
          user_id: userId,
          ...preferences,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        })
        .select()
        .single();

      if (error) throw error;

      // Limpiar cache
      await redis.del(`notification:prefs:${userId}`);

      logger.info({ userId, preferences }, 'Notification preferences updated');

      return updated;
    } catch (error) {
      logger.error({ error, userId }, 'Update preferences failed');
      throw error;
    }
  }

  /**
   * Suscribir a push notifications
   */
  async subscribeToPush(
    userId: string,
    subscription: PushSubscription
  ): Promise<void> {
    try {
      await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          user_agent: subscription.userAgent,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,endpoint'
        });

      logger.info({ userId }, 'Push subscription added');
    } catch (error) {
      logger.error({ error, userId }, 'Subscribe to push failed');
      throw error;
    }
  }

  /**
   * Desuscribir de push notifications
   */
  async unsubscribeFromPush(
    userId: string,
    endpoint: string
  ): Promise<void> {
    try {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', userId)
        .eq('endpoint', endpoint);

      logger.info({ userId, endpoint }, 'Push subscription removed');
    } catch (error) {
      logger.error({ error, userId }, 'Unsubscribe from push failed');
      throw error;
    }
  }

  /**
   * Notificar a múltiples usuarios
   */
  async notifyUsers(
    userIds: string[],
    notification: Omit<Notification, 'id' | 'user_id' | 'created_at'>
  ): Promise<void> {
    try {
      // Crear notificaciones en batch
      const notifications = userIds.map(userId => ({
        id: uuidv4(),
        user_id: userId,
        ...notification,
        read: false,
        created_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('notifications')
        .insert(notifications);

      if (error) throw error;

      // Enviar a queue para procesamiento asíncrono
      await addNotificationJob({
        userId: userIds,
        notification,
        channels: ['in-app', 'push']
      });

      logger.info({ 
        userCount: userIds.length,
        type: notification.type 
      }, 'Bulk notifications created');
    } catch (error) {
      logger.error({ error, userIds }, 'Notify users failed');
      throw error;
    }
  }

  /**
   * Notificar a admins de un tenant
   */
  async notifyTenantAdmins(
    tenantId: string,
    notification: Omit<Notification, 'id' | 'user_id' | 'created_at'>
  ): Promise<void> {
    try {
      // Obtener admins del tenant
      const { data: admins } = await supabase
        .from('user_tenants')
        .select('usuario_id')
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .in('rol', ['admin', 'owner']);

      if (!admins || admins.length === 0) return;

      const adminIds = admins.map(a => a.usuario_id);
      await this.notifyUsers(adminIds, notification);

      logger.info({ 
        tenantId, 
        adminCount: adminIds.length 
      }, 'Tenant admins notified');
    } catch (error) {
      logger.error({ error, tenantId }, 'Notify tenant admins failed');
      throw error;
    }
  }

  /**
   * Enviar push notification
   */
  async sendPushNotification(
    userId: string,
    notification: Partial<Notification>
  ): Promise<void> {
    try {
      // Obtener suscripciones del usuario
      const { data: subscriptions } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('user_id', userId);

      if (!subscriptions || subscriptions.length === 0) return;

      const payload = JSON.stringify({
        title: notification.title,
        body: notification.message,
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        data: {
          notificationId: notification.id,
          url: notification.action_url || '/',
          type: notification.type
        }
      });

      // Enviar a cada dispositivo
      const results = await Promise.allSettled(
        subscriptions.map(sub => 
          webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
              }
            },
            payload
          )
        )
      );

      // Eliminar suscripciones inválidas
      const failedIndices: number[] = [];
      results.forEach((result, index) => {
        if (result.status === 'rejected' && result.reason.statusCode === 410) {
          failedIndices.push(index);
        }
      });

      if (failedIndices.length > 0) {
        const failedEndpoints = failedIndices.map(i => subscriptions[i].endpoint);
        await supabase
          .from('push_subscriptions')
          .delete()
          .in('endpoint', failedEndpoints);
      }

      logger.info({ 
        userId, 
        sent: results.filter(r => r.status === 'fulfilled').length,
        failed: failedIndices.length 
      }, 'Push notifications sent');
    } catch (error) {
      logger.error({ error, userId }, 'Send push notification failed');
      // No lanzar error para no interrumpir el flujo
    }
  }

  /**
   * Enviar SMS notification
   */
  async sendSMSNotification(
    userId: string,
    notification: Partial<Notification>
  ): Promise<void> {
    try {
      // Obtener teléfono del usuario
      const { data: user } = await supabase
        .from('users')
        .select('telefono, phone_verified')
        .eq('id', userId)
        .single();

      if (!user || !user.phone_verified) return;

      // Aquí integrarías con tu proveedor de SMS (Twilio, etc.)
      logger.info({ 
        userId, 
        phone: user.telefono.substring(0, 6) + '****' 
      }, 'SMS notification would be sent');

      // TODO: Implementar envío real de SMS
    } catch (error) {
      logger.error({ error, userId }, 'Send SMS notification failed');
    }
  }

  /**
   * Eliminar notificaciones antiguas
   */
  async deleteOldNotifications(daysOld: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const { error, count } = await supabase
        .from('notifications')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .eq('read', true);

      if (error) throw error;

      logger.info({ 
        deletedCount: count,
        daysOld 
      }, 'Old notifications deleted');

      return count || 0;
    } catch (error) {
      logger.error({ error }, 'Delete old notifications failed');
      throw error;
    }
  }

  /**
   * Obtener usuarios por filtros (para notificaciones bulk)
   */
  async getUsersByFilters(
    tenantId: string,
    filters: {
      roles?: string[];
      active?: boolean;
      lastLoginDays?: number;
    }
  ): Promise<{ id: string; email?: string }[]> {
    try {
      let query = supabase
        .from('user_tenants')
        .select(`
          usuario_id,
          users!usuario_id (
            id,
            email,
            last_login
          )
        `)
        .eq('tenant_id', tenantId);

      if (filters.roles && filters.roles.length > 0) {
        query = query.in('rol', filters.roles);
      }

      if (typeof filters.active === 'boolean') {
        query = query.eq('activo', filters.active);
      }

      const { data } = await query;

      let users = data?.map(d => d.users) || [];

      // Filtrar por último login si se especifica
      if (filters.lastLoginDays) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - filters.lastLoginDays);
        
        users = users.filter(u => 
          u.last_login && new Date(u.last_login) > cutoffDate
        );
      }

      return users;
    } catch (error) {
      logger.error({ error, tenantId, filters }, 'Get users by filters failed');
      throw error;
    }
  }

  // Métodos privados
  private async getUserPreferences(userId: string): Promise<NotificationPreferences> {
    // Cache
    const cacheKey = `notification:prefs:${userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Obtener de BD
    const { data } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    const prefs = data || {
      user_id: userId,
      email_enabled: true,
      push_enabled: true,
      sms_enabled: false,
      in_app_enabled: true,
      email_frequency: 'instant',
      quiet_hours_start: null,
      quiet_hours_end: null,
      categories: {}
    };

    // Cachear
    await redis.setex(cacheKey, 3600, JSON.stringify(prefs));

    return prefs;
  }

  private determineChannels(
    notification: Partial<Notification>,
    preferences: NotificationPreferences
  ): NotificationChannel[] {
    const channels: NotificationChannel[] = [];

    // In-app siempre está habilitado
    if (preferences.in_app_enabled) {
      channels.push('in-app');
    }

    // Push para notificaciones importantes o urgentes
    if (preferences.push_enabled && 
        (notification.priority === 'high' || notification.priority === 'urgent')) {
      channels.push('push');
    }

    // Email según la frecuencia configurada
    if (preferences.email_enabled) {
      if (preferences.email_frequency === 'instant' || 
          notification.priority === 'urgent') {
        channels.push('email');
      }
    }

    // SMS solo para urgentes
    if (preferences.sms_enabled && notification.priority === 'urgent') {
      channels.push('sms');
    }

    // Verificar quiet hours
    if (this.isInQuietHours(preferences)) {
      // Durante quiet hours, solo notificaciones urgentes
      if (notification.priority !== 'urgent') {
        return ['in-app'];
      }
    }

    return channels;
  }

  private isInQuietHours(preferences: NotificationPreferences): boolean {
    if (!preferences.quiet_hours_start || !preferences.quiet_hours_end) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const start = parseInt(preferences.quiet_hours_start.split(':')[0]);
    const end = parseInt(preferences.quiet_hours_end.split(':')[0]);

    if (start < end) {
      return currentHour >= start && currentHour < end;
    } else {
      // Quiet hours cruzan medianoche
      return currentHour >= start || currentHour < end;
    }
  }

  private async incrementUnreadCount(userId: string): Promise<void> {
    const key = `notifications:unread:${userId}`;
    const exists = await redis.exists(key);
    
    if (exists) {
      await redis.incr(key);
    } else {
      // Si no existe, obtener de BD y cachear
      await this.getUnreadCount(userId);
    }
  }

  private async decrementUnreadCount(userId: string): Promise<void> {
    const key = `notifications:unread:${userId}`;
    const exists = await redis.exists(key);
    
    if (exists) {
      const count = await redis.decr(key);
      if (count < 0) {
        await redis.set(key, 0);
      }
    }
  }

  /**
   * Eliminar notificaciones leídas antiguas
   */
  async deleteOldReadNotifications(daysOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const { count } = await supabase
      .from('notifications')
      .delete()
      .eq('read', true)
      .lt('read_at', cutoffDate.toISOString());

    return count || 0;
  }
}

export const notificationService = new NotificationService();
