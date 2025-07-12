import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { appService } from './app.service';
import { subscriptionService } from './subscription.service';
import { tenantService } from './tenant.service';
import { storageService } from './storage.service';
import { notificationService } from './notification.service';
import { 
  NotFoundError, 
  ValidationError,
  App,
  Subscription,
  Tenant,
  User,
  PaginatedResponse
} from '../types';

// const supabase = getSupabase(); // Moved to lazy loading
// const redis = getRedis(); // Moved to lazy loading

interface DashboardStats {
  apps: {
    total_installed: number;
    total_available: number;
    recent_installs: number;
    pending_updates: number;
  };
  subscriptions: {
    total_active: number;
    total_cost_monthly: number;
    trials_ending_soon: number;
    renewal_upcoming: number;
  };
  storage: {
    used_gb: number;
    total_gb: number;
    usage_percentage: number;
    files_count: number;
  };
  activity: {
    recent_actions: any[];
    notifications_unread: number;
  };
}

interface QuickAction {
  id: string;
  type: 'app_install' | 'subscription_upgrade' | 'storage_expand' | 'invite_user';
  title: string;
  description: string;
  icon: string;
  url: string;
  priority: 'high' | 'medium' | 'low';
  metadata?: Record<string, any>;
}

interface AppLauncher {
  id: string;
  name: string;
  display_name: string;
  icon_url: string;
  description: string;
  category: string;
  last_accessed?: Date;
  access_url: string;
  status: 'active' | 'inactive' | 'pending';
  subscription_status?: 'active' | 'trial' | 'expired' | 'none';
  notifications_count?: number;
}

interface HubNotification {
  id: string;
  type: 'app_update' | 'subscription_renewal' | 'storage_limit' | 'security_alert' | 'system_message';
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  read: boolean;
  created_at: Date;
  expires_at?: Date;
  action_url?: string;
  action_label?: string;
  metadata?: Record<string, any>;
}

interface StorageOverview {
  total_gb: number;
  used_gb: number;
  available_gb: number;
  usage_percentage: number;
  files_count: number;
  recent_files: any[];
  top_consuming_apps: {
    app_name: string;
    usage_gb: number;
    percentage: number;
  }[];
}

interface TenantOverview {
  tenant: Tenant;
  role: string;
  permissions: string[];
  apps_count: number;
  subscriptions_count: number;
  storage_usage: number;
  last_activity: Date;
  is_owner: boolean;
  can_manage_billing: boolean;
}

class HubService {
  /**
   * Obtener dashboard principal del Hub
   */
  async getDashboard(tenantId: string, userId: string): Promise<DashboardStats> {
    try {
      const [
        installedApps,
        availableApps,
        activeSubscriptions,
        storageUsage,
        recentActivity,
        unreadNotifications
      ] = await Promise.all([
        appService.getInstalledApps(tenantId),
        appService.getAvailableApps(),
        subscriptionService.getTenantSubscriptions(tenantId),
        this.getStorageUsage(tenantId),
        this.getRecentActivity(tenantId, 10),
        this.getUnreadNotificationsCount(tenantId, userId)
      ]);

      // Calcular estadísticas de apps
      const recentInstalls = installedApps.filter(app => {
        const installDate = new Date(app.installed_at);
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        return installDate > weekAgo;
      }).length;

      // Calcular estadísticas de suscripciones
      const totalCostMonthly = activeSubscriptions.reduce((sum, sub) => 
        sum + (sub.price_monthly || 0), 0
      );

      const trialsEndingSoon = activeSubscriptions.filter(sub => {
        if (sub.status !== 'trialing' || !sub.trial_ends_at) return false;
        const trialEnd = new Date(sub.trial_ends_at);
        const threeDaysFromNow = new Date();
        threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
        return trialEnd <= threeDaysFromNow;
      }).length;

      const renewalsUpcoming = activeSubscriptions.filter(sub => {
        if (!sub.current_period_end) return false;
        const periodEnd = new Date(sub.current_period_end);
        const weekFromNow = new Date();
        weekFromNow.setDate(weekFromNow.getDate() + 7);
        return periodEnd <= weekFromNow;
      }).length;

      const dashboard: DashboardStats = {
        apps: {
          total_installed: installedApps.length,
          total_available: availableApps.pagination.total,
          recent_installs: recentInstalls,
          pending_updates: 0 // TODO: Implementar sistema de actualizaciones
        },
        subscriptions: {
          total_active: activeSubscriptions.length,
          total_cost_monthly: totalCostMonthly,
          trials_ending_soon: trialsEndingSoon,
          renewal_upcoming: renewalsUpcoming
        },
        storage: {
          used_gb: storageUsage.used_gb,
          total_gb: storageUsage.total_gb,
          usage_percentage: storageUsage.usage_percentage,
          files_count: storageUsage.files_count
        },
        activity: {
          recent_actions: recentActivity,
          notifications_unread: unreadNotifications
        }
      };

      return dashboard;
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Get dashboard failed');
      throw error;
    }
  }

  /**
   * Obtener launcher de aplicaciones
   */
  async getAppLauncher(tenantId: string, userId: string): Promise<AppLauncher[]> {
    try {
      const installedApps = await appService.getInstalledApps(tenantId);
      
      const launcher = await Promise.all(
        installedApps.map(async (installation) => {
          const [accessUrl, notificationsCount] = await Promise.all([
            appService.generateAppAccessUrl(tenantId, installation.app_id, userId),
            this.getAppNotificationsCount(tenantId, installation.app_id)
          ]);

          return {
            id: installation.app_id,
            name: installation.apps.name,
            display_name: installation.apps.display_name,
            icon_url: installation.apps.icon_url,
            description: installation.apps.description,
            category: installation.apps.app_categories?.name || 'General',
            last_accessed: installation.last_accessed 
              ? new Date(installation.last_accessed) 
              : undefined,
            access_url: accessUrl,
            status: installation.status as 'active' | 'inactive' | 'pending',
            subscription_status: installation.subscription 
              ? installation.subscription.status as 'active' | 'trial' | 'expired' | 'none'
              : 'none',
            notifications_count: notificationsCount
          };
        })
      );

      // Ordenar por última vez accedida y luego por nombre
      launcher.sort((a, b) => {
        if (a.last_accessed && b.last_accessed) {
          return b.last_accessed.getTime() - a.last_accessed.getTime();
        }
        if (a.last_accessed && !b.last_accessed) return -1;
        if (!a.last_accessed && b.last_accessed) return 1;
        return a.display_name.localeCompare(b.display_name);
      });

      return launcher;
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Get app launcher failed');
      throw error;
    }
  }

  /**
   * Obtener acciones rápidas recomendadas
   */
  async getQuickActions(tenantId: string, userId: string): Promise<QuickAction[]> {
    try {
      const [
        installedApps,
        activeSubscriptions,
        storageUsage,
        tenantLimits
      ] = await Promise.all([
        appService.getInstalledApps(tenantId),
        subscriptionService.getTenantSubscriptions(tenantId),
        this.getStorageUsage(tenantId),
        tenantService.getTenantLimits(tenantId)
      ]);

      const actions: QuickAction[] = [];

      // Acción: Instalar apps populares si no tiene muchas instaladas
      if (installedApps.length < 3) {
        actions.push({
          id: 'install_popular_apps',
          type: 'app_install',
          title: 'Explora aplicaciones populares',
          description: 'Descubre las apps más usadas para tu negocio',
          icon: 'apps',
          url: '/marketplace?featured=true',
          priority: 'medium'
        });
      }

      // Acción: Actualizar plan si está en trial
      const trialSubscriptions = activeSubscriptions.filter(sub => sub.status === 'trialing');
      if (trialSubscriptions.length > 0) {
        actions.push({
          id: 'upgrade_trial',
          type: 'subscription_upgrade',
          title: 'Actualiza tu plan',
          description: `Tienes ${trialSubscriptions.length} trial(s) terminando pronto`,
          icon: 'upgrade',
          url: '/billing/subscriptions',
          priority: 'high',
          metadata: {
            trials_count: trialSubscriptions.length
          }
        });
      }

      // Acción: Expandir almacenamiento si está cerca del límite
      if (storageUsage.usage_percentage > 80) {
        actions.push({
          id: 'expand_storage',
          type: 'storage_expand',
          title: 'Expandir almacenamiento',
          description: `Estás usando ${storageUsage.usage_percentage}% de tu espacio`,
          icon: 'storage',
          url: '/billing/storage',
          priority: 'high',
          metadata: {
            usage_percentage: storageUsage.usage_percentage,
            used_gb: storageUsage.used_gb,
            total_gb: storageUsage.total_gb
          }
        });
      }

      // Acción: Invitar usuarios si es owner y no tiene suficientes miembros
      const isOwner = await tenantService.isOwner(tenantId, userId);
      if (isOwner) {
        const membersCount = await tenantService.getMembersCount(tenantId);
        if (membersCount < 3) {
          actions.push({
            id: 'invite_users',
            type: 'invite_user',
            title: 'Invita a tu equipo',
            description: 'Agrega miembros para colaborar en tu espacio',
            icon: 'users',
            url: '/team/invitations',
            priority: 'medium',
            metadata: {
              current_members: membersCount,
              max_members: tenantLimits.max_users
            }
          });
        }
      }

      // Ordenar por prioridad
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

      return actions.slice(0, 4); // Máximo 4 acciones rápidas
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Get quick actions failed');
      throw error;
    }
  }

  /**
   * Obtener notificaciones del Hub
   */
  async getHubNotifications(
    tenantId: string,
    userId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<PaginatedResponse<HubNotification>> {
    try {
      const offset = (page - 1) * limit;

      const { data: notifications, error, count } = await supabase
        .from('notifications')
        .select('*')
        .or(`user_id.eq.${userId},tenant_id.eq.${tenantId}`)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const hubNotifications: HubNotification[] = (notifications || []).map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        priority: notification.priority || 'medium',
        read: notification.read,
        created_at: new Date(notification.created_at),
        expires_at: notification.expires_at ? new Date(notification.expires_at) : undefined,
        action_url: notification.action_url,
        action_label: notification.action_label,
        metadata: notification.metadata
      }));

      return {
        data: hubNotifications,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Get hub notifications failed');
      throw error;
    }
  }

  /**
   * Obtener resumen de almacenamiento
   */
  async getStorageOverview(tenantId: string): Promise<StorageOverview> {
    try {
      const [storageUsage, recentFiles, topApps] = await Promise.all([
        this.getStorageUsage(tenantId),
        this.getRecentFiles(tenantId, 10),
        this.getTopStorageConsumingApps(tenantId)
      ]);

      return {
        total_gb: storageUsage.total_gb,
        used_gb: storageUsage.used_gb,
        available_gb: storageUsage.total_gb - storageUsage.used_gb,
        usage_percentage: storageUsage.usage_percentage,
        files_count: storageUsage.files_count,
        recent_files: recentFiles,
        top_consuming_apps: topApps
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Get storage overview failed');
      throw error;
    }
  }

  /**
   * Obtener overview de tenants del usuario
   */
  async getTenantsOverview(userId: string): Promise<TenantOverview[]> {
    try {
      const { data: memberships, error } = await supabase
        .from('company_members')
        .select(`
          *,
          companies (
            id,
            name,
            razon_social,
            ruc,
            email,
            logo_url,
            created_at,
            owner_id
          )
        `)
        .eq('user_id', userId)
        .eq('active', true);

      if (error) throw error;

      const overviews = await Promise.all(
        (memberships || []).map(async (membership) => {
          const tenant = membership.companies;
          const [appsCount, subscriptionsCount, storageUsage, lastActivity] = await Promise.all([
            this.getInstalledAppsCount(tenant.id),
            this.getActiveSubscriptionsCount(tenant.id),
            this.getStorageUsage(tenant.id),
            this.getLastActivity(tenant.id, userId)
          ]);

          return {
            tenant,
            role: membership.role,
            permissions: membership.permissions || [],
            apps_count: appsCount,
            subscriptions_count: subscriptionsCount,
            storage_usage: storageUsage.used_gb,
            last_activity: lastActivity,
            is_owner: tenant.owner_id === userId,
            can_manage_billing: membership.permissions?.includes('billing.manage') || tenant.owner_id === userId
          };
        })
      );

      // Ordenar por última actividad
      overviews.sort((a, b) => b.last_activity.getTime() - a.last_activity.getTime());

      return overviews;
    } catch (error) {
      logger.error({ error, userId }, 'Get tenants overview failed');
      throw error;
    }
  }

  /**
   * Marcar notificación como leída
   */
  async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
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

      logger.info({ notificationId, userId }, 'Notification marked as read');
    } catch (error) {
      logger.error({ error, notificationId, userId }, 'Mark notification as read failed');
      throw error;
    }
  }

  /**
   * Marcar todas las notificaciones como leídas
   */
  async markAllNotificationsAsRead(tenantId: string, userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          read: true,
          read_at: new Date().toISOString()
        })
        .or(`user_id.eq.${userId},tenant_id.eq.${tenantId}`)
        .eq('read', false);

      if (error) throw error;

      logger.info({ tenantId, userId }, 'All notifications marked as read');
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Mark all notifications as read failed');
      throw error;
    }
  }

  /**
   * Registrar acceso a aplicación
   */
  async registerAppAccess(tenantId: string, appId: string, userId: string): Promise<void> {
    try {
      // Actualizar última vez accedida
      await supabase
        .from('app_installations')
        .update({
          last_accessed: new Date().toISOString(),
          access_count: supabase.raw('access_count + 1')
        })
        .eq('tenant_id', tenantId)
        .eq('app_id', appId);

      // Registrar en historial de acceso
      await supabase
        .from('app_access_history')
        .insert({
          tenant_id: tenantId,
          app_id: appId,
          user_id: userId,
          accessed_at: new Date().toISOString()
        });

      logger.info({ tenantId, appId, userId }, 'App access registered');
    } catch (error) {
      logger.error({ error, tenantId, appId, userId }, 'Register app access failed');
    }
  }

  // Métodos auxiliares privados

  private async getStorageUsage(tenantId: string): Promise<{
    used_gb: number;
    total_gb: number;
    usage_percentage: number;
    files_count: number;
  }> {
    try {
      const [usage, limits] = await Promise.all([
        storageService.getTenantUsage(tenantId),
        tenantService.getTenantLimits(tenantId)
      ]);

      const usedGb = usage.total_size_bytes / (1024 * 1024 * 1024);
      const totalGb = limits.max_storage_gb;
      const usagePercentage = totalGb > 0 ? (usedGb / totalGb) * 100 : 0;

      return {
        used_gb: Math.round(usedGb * 100) / 100,
        total_gb: totalGb,
        usage_percentage: Math.round(usagePercentage * 100) / 100,
        files_count: usage.files_count
      };
    } catch (error) {
      logger.error({ error, tenantId }, 'Get storage usage failed');
      return {
        used_gb: 0,
        total_gb: 5,
        usage_percentage: 0,
        files_count: 0
      };
    }
  }

  private async getRecentActivity(tenantId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data: activities, error } = await supabase
        .from('activities')
        .select(`
          *,
          users (
            id,
            email,
            profile (
              full_name,
              avatar_url
            )
          )
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return activities || [];
    } catch (error) {
      logger.error({ error, tenantId }, 'Get recent activity failed');
      return [];
    }
  }

  private async getUnreadNotificationsCount(tenantId: string, userId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact' })
        .or(`user_id.eq.${userId},tenant_id.eq.${tenantId}`)
        .eq('read', false);

      if (error) throw error;

      return count || 0;
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Get unread notifications count failed');
      return 0;
    }
  }

  private async getAppNotificationsCount(tenantId: string, appId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('app_notifications')
        .select('id', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .eq('app_id', appId)
        .eq('read', false);

      if (error) throw error;

      return count || 0;
    } catch (error) {
      logger.error({ error, tenantId, appId }, 'Get app notifications count failed');
      return 0;
    }
  }

  private async getRecentFiles(tenantId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data: files, error } = await supabase
        .from('files')
        .select(`
          id,
          name,
          size,
          mime_type,
          created_at,
          app_id,
          apps (
            name,
            display_name
          )
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return files || [];
    } catch (error) {
      logger.error({ error, tenantId }, 'Get recent files failed');
      return [];
    }
  }

  private async getTopStorageConsumingApps(tenantId: string): Promise<any[]> {
    try {
      const { data: apps, error } = await supabase
        .rpc('get_storage_by_app', { tenant_id: tenantId })
        .limit(5);

      if (error) throw error;

      return (apps || []).map(app => ({
        app_name: app.app_name,
        usage_gb: Math.round((app.total_size_bytes / (1024 * 1024 * 1024)) * 100) / 100,
        percentage: app.percentage
      }));
    } catch (error) {
      logger.error({ error, tenantId }, 'Get top storage consuming apps failed');
      return [];
    }
  }

  private async getInstalledAppsCount(tenantId: string): Promise<number> {
    const { count, error } = await supabase
      .from('app_installations')
      .select('id', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .eq('status', 'installed');

    if (error) {
      logger.error({ error, tenantId }, 'Get installed apps count failed');
      return 0;
    }

    return count || 0;
  }

  private async getActiveSubscriptionsCount(tenantId: string): Promise<number> {
    const { count, error } = await supabase
      .from('subscriptions')
      .select('id', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing']);

    if (error) {
      logger.error({ error, tenantId }, 'Get active subscriptions count failed');
      return 0;
    }

    return count || 0;
  }

  private async getLastActivity(tenantId: string, userId: string): Promise<Date> {
    const { data: activity, error } = await supabase
      .from('activities')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !activity) {
      return new Date(0); // Fecha muy antigua si no hay actividad
    }

    return new Date(activity.created_at);
  }
}

export const hubService = new HubService();