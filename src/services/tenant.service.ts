import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { 
  NotFoundError, 
  ValidationError,
  ConflictError,
  AuthorizationError,
  Tenant,
  TenantWithStats,
  TenantSettings,
  UserTenant,
  PaginatedResponse
} from '../types';
import { activityService } from './activity.service';
import { notificationService } from './notification.service';
import { subscriptionService } from './subscription.service';
import { ACTIVITY_ACTIONS, USER_ROLES } from '../constants';
import { validateRUC } from '../utils/helpers';

class TenantService {
  private getSupabase() {
    return getSupabase();
  }

  private getRedis() {
    return getRedis();
  }

  /**
   * Crear nuevo tenant
   */
  async createTenant(data: {
    ruc: string;
    razon_social: string;
    nombre_comercial?: string;
    direccion?: string;
    telefono?: string;
    email?: string;
    settings?: TenantSettings;
    ownerId: string;
  }): Promise<Tenant> {
    try {
      // Validar RUC
      if (!validateRUC(data.ruc)) {
        throw new ValidationError('RUC inválido');
      }

      // Verificar si ya existe
      const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('ruc', data.ruc)
        .single();

      if (existing) {
        throw new ConflictError('Ya existe una empresa con ese RUC');
      }

      // Verificar límite de empresas del usuario
      const userTenantCount = await this.getUserTenantCount(data.ownerId);
      const maxTenants = await this.getMaxTenantsForUser(data.ownerId);

      if (userTenantCount >= maxTenants) {
        throw new ValidationError(`Has alcanzado el límite de ${maxTenants} empresas`);
      }

      // Crear tenant
      const { data: tenant, error } = await supabase
        .from('tenants')
        .insert({
          id: uuidv4(),
          ruc: data.ruc,
          razon_social: data.razon_social,
          nombre_comercial: data.nombre_comercial || data.razon_social,
          direccion: data.direccion,
          telefono: data.telefono,
          email: data.email,
          owner_id: data.ownerId,
          settings: {
            theme: 'light',
            language: 'es',
            timezone: 'America/Guayaquil',
            currency: 'USD',
            ...data.settings
          },
          is_active: true
        })
        .select()
        .single();

      if (error) throw error;

      // Agregar owner como admin
      await this.addUserToTenant(tenant.id, data.ownerId, USER_ROLES.ADMIN, {
        addedBy: 'system',
        isOwner: true
      });

      // Crear suscripción trial
      await subscriptionService.createTrialSubscription(tenant.id);

      // Registrar actividad
      await activityService.log({
        tenant_id: tenant.id,
        user_id: data.ownerId,
        action: ACTIVITY_ACTIONS.TENANT_CREATED,
        resource_type: 'tenant',
        resource_id: tenant.id,
        details: {
          ruc: data.ruc,
          razon_social: data.razon_social
        }
      });

      // Notificar
      await notificationService.create({
        user_id: data.ownerId,
        type: 'tenant_created',
        title: 'Empresa creada',
        message: `Has creado la empresa ${data.razon_social}`,
        data: { tenantId: tenant.id }
      });

      logger.info({ 
        tenantId: tenant.id, 
        ownerId: data.ownerId,
        ruc: data.ruc 
      }, 'Tenant created');

      return tenant;
    } catch (error) {
      logger.error({ error }, 'Create tenant failed');
      throw error;
    }
  }

  /**
   * Obtener tenant por ID
   */
  async getTenantById(tenantId: string): Promise<TenantWithStats> {
    // Cache
    const cacheKey = `tenant:${tenantId}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select(`
        *,
        subscriptions (
          id,
          plan_id,
          status,
          current_period_end,
          features
        ),
        user_tenants (
          usuario_id,
          rol,
          users (
            id,
            nombre,
            apellido,
            email,
            avatar_url
          )
        )
      `)
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      throw new NotFoundError('Empresa');
    }

    // Obtener estadísticas
    const stats = await this.getTenantStats(tenantId);

    const tenantWithStats = {
      ...tenant,
      stats,
      memberCount: tenant.user_tenants?.length || 0,
      activeSubscription: tenant.subscriptions?.find((s: any) => s.status === 'active')
    };

    // Cachear por 5 minutos
    await redis.setex(cacheKey, 300, JSON.stringify(tenantWithStats));

    return tenantWithStats;
  }

  /**
   * Actualizar tenant
   */
  async updateTenant(
    tenantId: string,
    updates: Partial<Tenant>,
    updatedBy: string
  ): Promise<Tenant> {
    try {
      // Verificar permisos
      const hasPermission = await this.checkUserPermission(
        tenantId, 
        updatedBy, 
        'tenant.update'
      );

      if (!hasPermission) {
        throw new AuthorizationError('No tienes permisos para actualizar la empresa');
      }

      // No permitir cambiar RUC directamente
      delete updates.ruc;
      delete updates.owner_id;

      // Actualizar
      const { data: updatedTenant, error } = await supabase
        .from('tenants')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select()
        .single();

      if (error) throw error;

      // Limpiar cache
      await this.clearTenantCache(tenantId);

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: updatedBy,
        action: ACTIVITY_ACTIONS.TENANT_UPDATED,
        resource_type: 'tenant',
        resource_id: tenantId,
        details: {
          fields_updated: Object.keys(updates)
        }
      });

      logger.info({ tenantId, updates, updatedBy }, 'Tenant updated');

      return updatedTenant;
    } catch (error) {
      logger.error({ error, tenantId }, 'Update tenant failed');
      throw error;
    }
  }

  /**
   * Actualizar configuración del tenant
   */
  async updateSettings(
    tenantId: string,
    settings: Partial<TenantSettings>,
    updatedBy: string
  ): Promise<TenantSettings> {
    try {
      const hasPermission = await this.checkUserPermission(
        tenantId, 
        updatedBy, 
        'tenant.settings'
      );

      if (!hasPermission) {
        throw new AuthorizationError('No tienes permisos para cambiar la configuración');
      }

      // Obtener configuración actual
      const { data: tenant } = await supabase
        .from('tenants')
        .select('settings')
        .eq('id', tenantId)
        .single();

      if (!tenant) {
        throw new NotFoundError('Empresa');
      }

      // Merge configuraciones
      const newSettings = {
        ...tenant.settings,
        ...settings,
        updated_at: new Date().toISOString()
      };

      // Actualizar
      const { data: updated, error } = await supabase
        .from('tenants')
        .update({ settings: newSettings })
        .eq('id', tenantId)
        .select('settings')
        .single();

      if (error) throw error;

      // Limpiar cache
      await this.clearTenantCache(tenantId);

      logger.info({ tenantId, settings, updatedBy }, 'Tenant settings updated');

      return updated.settings;
    } catch (error) {
      logger.error({ error, tenantId }, 'Update settings failed');
      throw error;
    }
  }

  /**
   * Agregar usuario a tenant
   */
  async addUserToTenant(
    tenantId: string,
    userId: string,
    role: string,
    options: {
      addedBy: string;
      permissions?: string[];
      isOwner?: boolean;
    }
  ): Promise<UserTenant> {
    try {
      // Verificar si ya existe
      const { data: existing } = await supabase
        .from('user_tenants')
        .select('id, activo')
        .eq('tenant_id', tenantId)
        .eq('usuario_id', userId)
        .single();

      if (existing) {
        if (existing.activo) {
          throw new ConflictError('El usuario ya es miembro de la empresa');
        }

        // Reactivar si estaba inactivo
        const { data: reactivated, error } = await supabase
          .from('user_tenants')
          .update({
            activo: true,
            rol: role,
            permisos: options.permissions || this.getDefaultPermissions(role),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)
          .select()
          .single();

        if (error) throw error;
        return reactivated;
      }

      // Crear nueva relación
      const { data: userTenant, error } = await supabase
        .from('user_tenants')
        .insert({
          tenant_id: tenantId,
          usuario_id: userId,
          rol: role,
          permisos: options.permissions || this.getDefaultPermissions(role),
          activo: true,
          added_by: options.addedBy
        })
        .select()
        .single();

      if (error) throw error;

      // Si es owner, actualizar tenant
      if (options.isOwner) {
        await supabase
          .from('tenants')
          .update({ owner_id: userId })
          .eq('id', tenantId);
      }

      // Limpiar cache
      await Promise.all([
        redis.del(`user:${userId}`),
        this.clearTenantCache(tenantId)
      ]);

      // Notificar al usuario
      await notificationService.create({
        user_id: userId,
        type: 'added_to_tenant',
        title: 'Agregado a empresa',
        message: `Has sido agregado a una empresa con rol ${role}`,
        data: { tenantId, role }
      });

      logger.info({ 
        tenantId, 
        userId, 
        role, 
        addedBy: options.addedBy 
      }, 'User added to tenant');

      return userTenant;
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Add user to tenant failed');
      throw error;
    }
  }

  /**
   * Remover usuario de tenant
   */
  async removeUserFromTenant(
    tenantId: string,
    userId: string,
    removedBy: string
  ): Promise<void> {
    try {
      // Verificar que no sea el owner
      const { data: tenant } = await supabase
        .from('tenants')
        .select('owner_id')
        .eq('id', tenantId)
        .single();

      if (tenant?.owner_id === userId) {
        throw new ValidationError('No se puede remover al propietario de la empresa');
      }

      // Verificar permisos
      const hasPermission = await this.checkUserPermission(
        tenantId,
        removedBy,
        'team.remove'
      );

      if (!hasPermission && removedBy !== userId) {
        throw new AuthorizationError('No tienes permisos para remover usuarios');
      }

      // Soft delete
      await supabase
        .from('user_tenants')
        .update({
          activo: false,
          removed_at: new Date().toISOString(),
          removed_by: removedBy
        })
        .eq('tenant_id', tenantId)
        .eq('usuario_id', userId);

      // Limpiar cache
      await Promise.all([
        redis.del(`user:${userId}`),
        this.clearTenantCache(tenantId)
      ]);

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: removedBy,
        action: ACTIVITY_ACTIONS.USER_REMOVED,
        resource_type: 'user_tenant',
        resource_id: userId,
        details: {
          removed_user: userId
        }
      });

      logger.info({ 
        tenantId, 
        userId, 
        removedBy 
      }, 'User removed from tenant');
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Remove user from tenant failed');
      throw error;
    }
  }

  /**
   * Actualizar rol de usuario
   */
  async updateUserRole(
    tenantId: string,
    userId: string,
    newRole: string,
    updatedBy: string
  ): Promise<UserTenant> {
    try {
      // Verificar permisos
      const hasPermission = await this.checkUserPermission(
        tenantId,
        updatedBy,
        'team.update_role'
      );

      if (!hasPermission) {
        throw new AuthorizationError('No tienes permisos para cambiar roles');
      }

      // No permitir cambiar rol del owner
      const { data: tenant } = await supabase
        .from('tenants')
        .select('owner_id')
        .eq('id', tenantId)
        .single();

      if (tenant?.owner_id === userId && newRole !== USER_ROLES.ADMIN) {
        throw new ValidationError('El propietario siempre debe ser administrador');
      }

      // Actualizar rol
      const { data: updated, error } = await supabase
        .from('user_tenants')
        .update({
          rol: newRole,
          permisos: this.getDefaultPermissions(newRole),
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('usuario_id', userId)
        .select()
        .single();

      if (error) throw error;

      // Limpiar cache
      await Promise.all([
        redis.del(`user:${userId}`),
        this.clearTenantCache(tenantId)
      ]);

      // Notificar al usuario
      await notificationService.create({
        user_id: userId,
        type: 'role_changed',
        title: 'Rol actualizado',
        message: `Tu rol ha sido cambiado a ${newRole}`,
        data: { tenantId, newRole }
      });

      logger.info({ 
        tenantId, 
        userId, 
        newRole, 
        updatedBy 
      }, 'User role updated');

      return updated;
    } catch (error) {
      logger.error({ error, tenantId, userId }, 'Update user role failed');
      throw error;
    }
  }

  /**
   * Transferir propiedad
   */
  async transferOwnership(
    tenantId: string,
    newOwnerId: string,
    currentOwnerId: string
  ): Promise<void> {
    try {
      // Verificar que el solicitante sea el owner actual
      const { data: tenant } = await supabase
        .from('tenants')
        .select('owner_id, razon_social')
        .eq('id', tenantId)
        .single();

      if (!tenant || tenant.owner_id !== currentOwnerId) {
        throw new AuthorizationError('Solo el propietario puede transferir la empresa');
      }

      // Verificar que el nuevo owner sea miembro
      const { data: membership } = await supabase
        .from('user_tenants')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('usuario_id', newOwnerId)
        .eq('activo', true)
        .single();

      if (!membership) {
        throw new ValidationError('El nuevo propietario debe ser miembro de la empresa');
      }

      // Iniciar transacción
      await supabase.rpc('begin_transaction');

      try {
        // Actualizar tenant
        await supabase
          .from('tenants')
          .update({ owner_id: newOwnerId })
          .eq('id', tenantId);

        // Asegurar que el nuevo owner sea admin
        await supabase
          .from('user_tenants')
          .update({
            rol: USER_ROLES.ADMIN,
            permisos: this.getDefaultPermissions(USER_ROLES.ADMIN)
          })
          .eq('tenant_id', tenantId)
          .eq('usuario_id', newOwnerId);

        // Transferir suscripciones
        await subscriptionService.transferSubscriptions(tenantId, newOwnerId);

        await supabase.rpc('commit_transaction');
      } catch (error) {
        await supabase.rpc('rollback_transaction');
        throw error;
      }

      // Limpiar cache
      await this.clearTenantCache(tenantId);

      // Notificar a ambos usuarios
      await Promise.all([
        notificationService.create({
          user_id: currentOwnerId,
          type: 'ownership_transferred',
          title: 'Propiedad transferida',
          message: `Has transferido la empresa ${tenant.razon_social}`,
          data: { tenantId, newOwnerId }
        }),
        notificationService.create({
          user_id: newOwnerId,
          type: 'ownership_received',
          title: 'Nueva empresa',
          message: `Ahora eres propietario de ${tenant.razon_social}`,
          data: { tenantId, previousOwnerId: currentOwnerId }
        })
      ]);

      logger.info({ 
        tenantId, 
        previousOwnerId: currentOwnerId, 
        newOwnerId 
      }, 'Ownership transferred');
    } catch (error) {
      logger.error({ error, tenantId }, 'Transfer ownership failed');
      throw error;
    }
  }

  /**
   * Obtener miembros del tenant
   */
  async getTenantMembers(
    tenantId: string,
    options: {
      includeInactive?: boolean;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<PaginatedResponse<UserTenant>> {
    const { includeInactive = false, page = 1, limit = 50 } = options;

    let query = supabase
      .from('user_tenants')
      .select(`
        *,
        users (
          id,
          nombre,
          apellido,
          email,
          forvara_mail,
          avatar_url,
          last_login
        )
      `, { count: 'exact' })
      .eq('tenant_id', tenantId);

    if (!includeInactive) {
      query = query.eq('activo', true);
    }

    const offset = (page - 1) * limit;
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

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
  }

  /**
   * Buscar tenants
   */
  async searchTenants(params: {
    query?: string;
    ownerId?: string;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<Tenant>> {
    const { 
      query, 
      ownerId, 
      isActive = true,
      page = 1, 
      limit = 20 
    } = params;

    let queryBuilder = supabase
      .from('tenants')
      .select('*', { count: 'exact' });

    if (query) {
      queryBuilder = queryBuilder.or(
        `razon_social.ilike.%${query}%,nombre_comercial.ilike.%${query}%,ruc.ilike.%${query}%`
      );
    }

    if (ownerId) {
      queryBuilder = queryBuilder.eq('owner_id', ownerId);
    }

    if (typeof isActive === 'boolean') {
      queryBuilder = queryBuilder.eq('is_active', isActive);
    }

    const offset = (page - 1) * limit;
    queryBuilder = queryBuilder
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;

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
  }

  /**
   * Actualizar uso de storage
   */
  async updateStorageUsage(tenantId: string, bytesChange: number): Promise<void> {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('storage_used_bytes, storage_limit_bytes')
        .eq('id', tenantId)
        .single();

      if (!tenant) return;

      const newUsage = Math.max(0, tenant.storage_used_bytes + bytesChange);

      // Verificar límite
      if (newUsage > tenant.storage_limit_bytes && bytesChange > 0) {
        throw new ValidationError('Límite de almacenamiento excedido');
      }

      await supabase
        .from('tenants')
        .update({ 
          storage_used_bytes: newUsage,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);

      // Limpiar cache
      await this.clearTenantCache(tenantId);

      // Si está cerca del límite, notificar
      const usagePercentage = (newUsage / tenant.storage_limit_bytes) * 100;
      if (usagePercentage >= 90 && bytesChange > 0) {
        await notificationService.notifyTenantAdmins(tenantId, {
          type: 'storage_warning',
          title: 'Almacenamiento casi lleno',
          message: `El almacenamiento está al ${Math.round(usagePercentage)}% de capacidad`,
          priority: 'high'
        });
      }
    } catch (error) {
      logger.error({ error, tenantId }, 'Update storage usage failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async getTenantStats(tenantId: string): Promise<any> {
    const [members, files, activities] = await Promise.all([
      supabase
        .from('user_tenants')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('activo', true),
      
      supabase
        .from('shared_files')
        .select('size_bytes', { count: 'exact' })
        .eq('tenant_id', tenantId),
      
      supabase
        .from('activity_logs')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    ]);

    return {
      totalMembers: members.count || 0,
      totalFiles: files.count || 0,
      storageUsed: files.data?.reduce((sum, f) => sum + f.size_bytes, 0) || 0,
      monthlyActivity: activities.count || 0
    };
  }

  private async checkUserPermission(
    tenantId: string,
    userId: string,
    permission: string
  ): Promise<boolean> {
    const { data: userTenant } = await supabase
      .from('user_tenants')
      .select('rol, permisos')
      .eq('tenant_id', tenantId)
      .eq('usuario_id', userId)
      .eq('activo', true)
      .single();

    if (!userTenant) return false;

    // Admins tienen todos los permisos
    if (userTenant.rol === USER_ROLES.ADMIN) return true;

    // Verificar permiso específico
    return userTenant.permisos?.includes(permission) || false;
  }

  private getDefaultPermissions(role: string): string[] {
    const permissions: Record<string, string[]> = {
      [USER_ROLES.ADMIN]: ['*'], // Todos los permisos
      [USER_ROLES.MANAGER]: [
        'tenant.read',
        'tenant.update',
        'team.read',
        'team.invite',
        'files.*',
        'mail.*',
        'reports.read'
      ],
      [USER_ROLES.MEMBER]: [
        'tenant.read',
        'team.read',
        'files.read',
        'files.upload',
        'mail.read',
        'mail.send'
      ],
      [USER_ROLES.VIEWER]: [
        'tenant.read',
        'team.read',
        'files.read',
        'mail.read'
      ]
    };

    return permissions[role] || permissions[USER_ROLES.VIEWER];
  }

  private async getUserTenantCount(userId: string): Promise<number> {
    const { count } = await supabase
      .from('user_tenants')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', userId)
      .eq('activo', true);

    return count || 0;
  }

  private async getMaxTenantsForUser(userId: string): Promise<number> {
    // Aquí podrías implementar lógica basada en el plan del usuario
    // Por ahora, límite fijo
    return 5;
  }

  private async clearTenantCache(tenantId: string): Promise<void> {
    const pattern = `tenant:${tenantId}*`;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}

export const tenantService = new TenantService();
