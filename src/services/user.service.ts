import bcrypt from 'bcryptjs';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { 
  NotFoundError, 
  ValidationError,
  ConflictError,
  ForvaraUser,
  UserProfile,
  UserSettings,
  PaginatedResponse
} from '../types';
import { emailQueue } from '../queues';
import { activityService } from './activity.service';
import { storageService } from './storage.service';
import { ACTIVITY_ACTIONS } from '../constants';

// Lazy initialization to avoid circular dependencies

class UserService {
  private getSupabase() {
    return getSupabase();
  }
  
  private getRedis() {
    return getRedis();
  }

  /**
   * Buscar usuario por teléfono
   */
  async findByPhone(phone: string): Promise<ForvaraUser | null> {
    const { data: user, error } = await this.getSupabase()
      .from('users')
      .select('*')
      .eq('telefono', phone)
      .single();

    if (error || !user) {
      return null;
    }

    return user;
  }

  /**
   * Buscar usuario por email
   */
  async findByEmail(email: string): Promise<ForvaraUser | null> {
    const { data: user, error } = await this.getSupabase()
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return null;
    }

    return user;
  }

  /**
   * Obtener usuario por ID
   */
  async getUserById(userId: string): Promise<ForvaraUser> {
    // Intentar obtener de cache primero
    const cacheKey = `user:${userId}`;
    const cached = await this.getRedis().get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const { data: user, error } = await this.getSupabase()
      .from('users')
      .select(`
        *,
        user_tenants (
          tenant_id,
          rol,
          permisos,
          activo,
          tenants (*)
        )
      `)
      .eq('id', userId)
      .single();

    if (error || !user) {
      throw new NotFoundError('Usuario');
    }

    // Cachear por 5 minutos
    await this.getRedis().setex(cacheKey, 300, JSON.stringify(user));

    return user;
  }

  /**
   * Obtener perfil de usuario
   */
  async getUserProfile(userId: string): Promise<UserProfile> {
    const user = await this.getUserById(userId);

    // Obtener estadísticas adicionales
    const [stats, recentActivity] = await Promise.all([
      this.getUserStats(userId),
      this.getRecentActivity(userId)
    ]);

    return {
      ...user,
      stats,
      recentActivity,
      completionPercentage: this.calculateProfileCompletion(user)
    };
  }

  /**
   * Actualizar perfil de usuario
   */
  async updateUserProfile(
    userId: string, 
    updates: Partial<ForvaraUser>
  ): Promise<ForvaraUser> {
    try {
      // Validaciones específicas
      if (updates.email) {
        const { data: existing } = await this.getSupabase()
          .from('users')
          .select('id')
          .eq('email', updates.email)
          .neq('id', userId)
          .single();

        if (existing) {
          throw new ConflictError('Email ya está en uso');
        }

        // Marcar email como no verificado si cambia
        updates.email_verified = false;
      }

      if (updates.telefono) {
        const { data: existing } = await this.getSupabase()
          .from('users')
          .select('id')
          .eq('telefono', updates.telefono)
          .neq('id', userId)
          .single();

        if (existing) {
          throw new ConflictError('Teléfono ya está en uso');
        }

        // Marcar teléfono como no verificado si cambia
        updates.phone_verified = false;
      }

      // No permitir cambiar forvara_mail directamente
      delete updates.forvara_mail;

      // Actualizar
      const { data: updatedUser, error } = await this.getSupabase()
        .from('users')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select()
        .single();

      if (error) throw error;

      // Limpiar cache
      await this.getRedis().del(`user:${userId}`);

      // Registrar actividad
      await activityService.log({
        user_id: userId,
        action: ACTIVITY_ACTIONS.USER_PROFILE_UPDATED,
        resource_type: 'user',
        resource_id: userId,
        details: { 
          fields_updated: Object.keys(updates),
          ip_address: null // Se pasa desde el controller
        }
      });

      // Si cambió el email, enviar verificación
      if (updates.email) {
        await this.sendEmailVerification(userId);
      }

      logger.info({ userId, updates }, 'User profile updated');

      return updatedUser;
    } catch (error) {
      logger.error({ error, userId }, 'Update profile failed');
      throw error;
    }
  }

  /**
   * Cambiar contraseña
   */
  async changePassword(
    userId: string, 
    currentPassword: string, 
    newPassword: string
  ): Promise<void> {
    try {
      // Obtener usuario
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('password_hash, email')
        .eq('id', userId)
        .single();

      if (!user) {
        throw new NotFoundError('Usuario');
      }

      // Verificar contraseña actual
      const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
      if (!validPassword) {
        throw new ValidationError('Contraseña actual incorrecta');
      }

      // Hash nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Actualizar
      await this.getSupabase()
        .from('users')
        .update({
          password_hash: hashedPassword,
          password_changed_at: new Date().toISOString()
        })
        .eq('id', userId);

      // Actualizar en Supabase Auth
      await this.getSupabase().auth.admin.updateUserById(userId, {
        password: newPassword
      });

      // Notificar cambio
      if (user.email) {
        await emailQueue.add({
          to: user.email,
          subject: 'Contraseña cambiada',
          template: 'password-changed',
          data: {
            changedAt: new Date().toLocaleString()
          }
        });
      }

      logger.info({ userId }, 'Password changed');
    } catch (error) {
      logger.error({ error, userId }, 'Change password failed');
      throw error;
    }
  }

  /**
   * Actualizar avatar
   */
  async updateAvatar(userId: string, file: Express.Multer.File): Promise<string> {
    try {
      // Validar tipo de archivo
      if (!file.mimetype.startsWith('image/')) {
        throw new ValidationError('El archivo debe ser una imagen');
      }

      // Subir a storage
      const path = `avatars/${userId}/${Date.now()}-${file.originalname}`;
      const url = await storageService.uploadFile(file.buffer, path, {
        contentType: file.mimetype,
        metadata: {
          userId,
          type: 'avatar'
        }
      });

      // Obtener avatar anterior para eliminar
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('avatar_url')
        .eq('id', userId)
        .single();

      // Actualizar URL en BD
      await this.getSupabase()
        .from('users')
        .update({ avatar_url: url })
        .eq('id', userId);

      // Eliminar avatar anterior si existe
      if (user?.avatar_url) {
        try {
          await storageService.deleteFile(user.avatar_url);
        } catch (error) {
          logger.warn({ error, oldAvatar: user.avatar_url }, 'Failed to delete old avatar');
        }
      }

      // Limpiar cache
      await this.getRedis().del(`user:${userId}`);

      logger.info({ userId, avatarUrl: url }, 'Avatar updated');

      return url;
    } catch (error) {
      logger.error({ error, userId }, 'Update avatar failed');
      throw error;
    }
  }

  /**
   * Actualizar configuración
   */
  async updateSettings(
    userId: string, 
    settings: Partial<UserSettings>
  ): Promise<UserSettings> {
    try {
      // Obtener configuración actual
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('settings')
        .eq('id', userId)
        .single();

      if (!user) {
        throw new NotFoundError('Usuario');
      }

      // Merge configuraciones
      const newSettings = {
        ...user.settings,
        ...settings,
        updated_at: new Date().toISOString()
      };

      // Actualizar
      const { data: updated, error } = await this.getSupabase()
        .from('users')
        .update({ settings: newSettings })
        .eq('id', userId)
        .select('settings')
        .single();

      if (error) throw error;

      // Limpiar cache
      await this.getRedis().del(`user:${userId}`);

      logger.info({ userId, settings }, 'User settings updated');

      return updated.settings;
    } catch (error) {
      logger.error({ error, userId }, 'Update settings failed');
      throw error;
    }
  }

  /**
   * Buscar usuarios
   */
  async searchUsers(params: {
    query?: string;
    tenantId?: string;
    role?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<ForvaraUser>> {
    try {
      const { 
        query, 
        tenantId, 
        role, 
        isActive = true,
        page = 1, 
        limit = 20 
      } = params;

      let queryBuilder = supabase
        .from('users')
        .select('*', { count: 'exact' });

      // Búsqueda por texto
      if (query) {
        queryBuilder = queryBuilder.or(
          `nombre.ilike.%${query}%,apellido.ilike.%${query}%,email.ilike.%${query}%,forvara_mail.ilike.%${query}%`
        );
      }

      // Filtro por tenant
      if (tenantId) {
        const { data: userIds } = await this.getSupabase()
          .from('user_tenants')
          .select('usuario_id')
          .eq('tenant_id', tenantId)
          .eq('activo', true);

        if (userIds) {
          queryBuilder = queryBuilder.in(
            'id', 
            userIds.map(u => u.usuario_id)
          );
        }
      }

      // Filtro por estado
      if (typeof isActive === 'boolean') {
        queryBuilder = queryBuilder.eq('is_active', isActive);
      }

      // Paginación
      const offset = (page - 1) * limit;
      queryBuilder = queryBuilder
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: users, error, count } = await queryBuilder;

      if (error) throw error;

      return {
        data: users || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error }, 'Search users failed');
      throw error;
    }
  }

  /**
   * Verificar email
   */
  async verifyEmail(userId: string, code: string): Promise<void> {
    try {
      const key = `email_verify:${userId}`;
      const storedCode = await this.getRedis().get(key);

      if (!storedCode || storedCode !== code) {
        throw new ValidationError('Código inválido o expirado');
      }

      // Marcar como verificado
      await this.getSupabase()
        .from('users')
        .update({ 
          email_verified: true,
          email_verified_at: new Date().toISOString()
        })
        .eq('id', userId);

      // Limpiar código
      await this.getRedis().del(key);

      logger.info({ userId }, 'Email verified');
    } catch (error) {
      logger.error({ error, userId }, 'Email verification failed');
      throw error;
    }
  }

  /**
   * Verificar teléfono
   */
  async verifyPhone(phone: string, code: string): Promise<void> {
    try {
      const key = `phone_verify:${phone}`;
      const storedCode = await this.getRedis().get(key);

      if (!storedCode || storedCode !== code) {
        throw new ValidationError('Código inválido o expirado');
      }

      // Marcar como verificado
      await this.getSupabase()
        .from('users')
        .update({ 
          phone_verified: true,
          phone_verified_at: new Date().toISOString()
        })
        .eq('telefono', phone);

      // Limpiar código
      await this.getRedis().del(key);

      logger.info({ phone }, 'Phone verified');
    } catch (error) {
      logger.error({ error, phone }, 'Phone verification failed');
      throw error;
    }
  }

  /**
   * Eliminar cuenta
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    try {
      // Verificar contraseña
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('password_hash')
        .eq('id', userId)
        .single();

      if (!user) {
        throw new NotFoundError('Usuario');
      }

      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        throw new ValidationError('Contraseña incorrecta');
      }

      // Soft delete
      await this.getSupabase()
        .from('users')
        .update({
          is_active: false,
          deleted_at: new Date().toISOString(),
          email: `deleted_${userId}@forvara.com`,
          telefono: `deleted_${userId}`,
          forvara_mail: `deleted_${userId}`
        })
        .eq('id', userId);

      // Eliminar de Supabase Auth
      await this.getSupabase().auth.admin.deleteUser(userId);

      // Limpiar todas las sesiones
      await this.getRedis().eval(
        `for _,k in ipairs(redis.call('keys','session:*:${userId}')) do redis.call('del',k) end`,
        0
      );

      logger.info({ userId }, 'Account deleted');
    } catch (error) {
      logger.error({ error, userId }, 'Delete account failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async getUserStats(userId: string): Promise<any> {
    const [tenantCount, fileCount, activityCount] = await Promise.all([
      supabase
        .from('user_tenants')
        .select('*', { count: 'exact', head: true })
        .eq('usuario_id', userId)
        .eq('activo', true),
      
      supabase
        .from('shared_files')
        .select('*', { count: 'exact', head: true })
        .eq('uploaded_by', userId),
      
      supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    ]);

    return {
      tenantsCount: tenantCount.count || 0,
      filesUploaded: fileCount.count || 0,
      monthlyActivity: activityCount.count || 0
    };
  }

  private async getRecentActivity(userId: string, limit: number = 10): Promise<any[]> {
    const { data } = await this.getSupabase()
      .from('activity_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return data || [];
  }

  private calculateProfileCompletion(user: ForvaraUser): number {
    const fields = [
      'nombre',
      'apellido',
      'email',
      'telefono',
      'avatar_url',
      'bio',
      'email_verified',
      'phone_verified'
    ];

    const completed = fields.filter(field => {
      const value = user[field as keyof ForvaraUser];
      return value !== null && value !== undefined && value !== '';
    }).length;

    return Math.round((completed / fields.length) * 100);
  }

  private async sendEmailVerification(userId: string): Promise<void> {
    const { data: user } = await this.getSupabase()
      .from('users')
      .select('email, nombre')
      .eq('id', userId)
      .single();

    if (!user?.email) return;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Guardar código en Redis con TTL de 24 horas
    await this.getRedis().setex(`email_verify:${userId}`, 86400, code);

    // Enviar email
    await emailQueue.add({
      to: user.email,
      subject: 'Verifica tu email - Forvara',
      template: 'email-verification',
      data: {
        name: user.nombre,
        code
      }
    });
  }
}

export const userService = new UserService();
