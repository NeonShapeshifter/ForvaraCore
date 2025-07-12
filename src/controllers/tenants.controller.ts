import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { tenantService } from '../services/tenant.service';
import { userService } from '../services/user.service';
import { subscriptionService } from '../services/subscription.service';
import { fileService } from '../services/file.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS, UserRole, AppIds } from '../constants';
import { 
  NotFoundError, 
  ValidationError, 
  ConflictError,
  AuthorizationError 
} from '../types';

export const getUserTenants = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { active } = req.query;

    const userTenants = await userService.getUserTenants(userId, {
      activeOnly: active === 'true'
    });

    const tenantsWithStats = await Promise.all(
      userTenants.map(async (ut) => {
        const [memberCount, activeApps] = await Promise.all([
          tenantService.getMemberCount(ut.tenant.id),
          subscriptionService.getActiveTenantApps(ut.tenant.id)
        ]);

        return {
          id: ut.tenant.id,
          nombre: ut.tenant.nombre,
          logo_url: ut.tenant.logo_url,
          rol: ut.rol,
          joined_at: ut.joined_at,
          is_owner: ut.tenant.created_by === userId,
          is_active: ut.activo && ut.tenant.activo,
          stats: {
            members: memberCount,
            active_apps: activeApps.length,
            storage_used_gb: ut.tenant.storage_used_gb
          }
        };
      })
    );

    res.json(createApiResponse(
      true,
      tenantsWithStats,
      'Empresas obtenidas exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const createTenant = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const tenantData = req.body;

    // Verificar si el RUC ya existe
    if (tenantData.ruc) {
      const existingTenant = await tenantService.findByRuc(tenantData.ruc);
      if (existingTenant) {
        throw new ConflictError('El RUC ya está registrado');
      }
    }

    // Crear tenant
    const tenant = await tenantService.createTenant({
      ...tenantData,
      created_by: userId,
      configuracion: {
        sector: tenantData.sector || 'other',
        size: tenantData.size || 'small',
        onboarding_completed: false,
        features_enabled: [],
        custom_settings: {}
      }
    });

    // Agregar al usuario como admin del tenant
    await tenantService.addMember(tenant.id, userId, UserRole.ADMIN);

    // Crear suscripción trial para Forvara Hub
    await subscriptionService.createTrialSubscription(
      tenant.id,
      AppIds.HUB,
      30 // 30 días de trial
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenant.id,
      action: ACTIVITY_ACTIONS.TENANT_CREATED,
      details: {
        tenant_name: tenant.nombre,
        sector: tenantData.sector
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    logger.info({
      userId,
      tenantId: tenant.id,
      tenantName: tenant.nombre
    }, 'Tenant created successfully');

    res.status(201).json(createApiResponse(
      true,
      {
        tenant: {
          id: tenant.id,
          nombre: tenant.nombre,
          logo_url: tenant.logo_url,
          created_at: tenant.created_at
        },
        membership: {
          rol: UserRole.ADMIN,
          joined_at: new Date()
        },
        trial: {
          app: AppIds.HUB,
          days_remaining: 30
        }
      },
      'Empresa creada exitosamente',
      `Bienvenido a Forvara! Tienes 30 días de prueba gratis.`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTenantById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const userId = req.userId!;

    // Verificar acceso
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess) {
      throw new NotFoundError('Empresa');
    }

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Empresa');
    }

    // Obtener información adicional
    const [memberCount, activeApps, usage] = await Promise.all([
      tenantService.getMemberCount(tenantId),
      subscriptionService.getActiveTenantApps(tenantId),
      tenantService.getTenantUsage(tenantId)
    ]);

    res.json(createApiResponse(
      true,
      {
        ...tenant,
        user_role: userAccess.rol,
        stats: {
          members: memberCount,
          active_apps: activeApps.length,
          usage
        }
      },
      'Información de empresa obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateTenant = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const updates = req.body;
    const userId = req.userId!;

    // Verificar que es admin
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess || userAccess.rol !== UserRole.ADMIN) {
      throw new AuthorizationError('Solo administradores pueden actualizar la empresa');
    }

    // Si se está cambiando el RUC, verificar que no exista
    if (updates.ruc) {
      const existingTenant = await tenantService.findByRuc(updates.ruc);
      if (existingTenant && existingTenant.id !== tenantId) {
        throw new ConflictError('El RUC ya está registrado');
      }
    }

    const updatedTenant = await tenantService.updateTenant(tenantId, updates);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.TENANT_UPDATED,
      details: {
        fields_updated: Object.keys(updates)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedTenant,
      'Empresa actualizada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateLogo = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const file = req.file;
    const userId = req.userId!;

    if (!file) {
      throw new ValidationError('No se proporcionó archivo');
    }

    // Verificar que es admin
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess || userAccess.rol !== UserRole.ADMIN) {
      throw new AuthorizationError('Solo administradores pueden actualizar el logo');
    }

    // Validar tipo de archivo
    if (!file.mimetype.startsWith('image/')) {
      throw new ValidationError('El archivo debe ser una imagen');
    }

    // Subir archivo
    const uploadedFile = await fileService.uploadTenantLogo(
      tenantId,
      file,
      userId
    );

    // Actualizar tenant
    await tenantService.updateTenant(tenantId, {
      logo_url: uploadedFile.public_url,
      logo_file_id: uploadedFile.id
    });

    res.json(createApiResponse(
      true,
      {
        logo_url: uploadedFile.public_url,
        file_id: uploadedFile.id
      },
      'Logo actualizado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTenantStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const { period = '30d' } = req.query;
    const userId = req.userId!;

    // Verificar acceso
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess) {
      throw new NotFoundError('Empresa');
    }

    const stats = await tenantService.getTenantStats(tenantId, period as string);

    res.json(createApiResponse(
      true,
      stats,
      'Estadísticas obtenidas exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTenantUsage = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const userId = req.userId!;

    // Verificar acceso
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess) {
      throw new NotFoundError('Empresa');
    }

    const usage = await tenantService.getTenantUsage(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);
    const analysis = subscriptionService.analyzeUsage(usage, limits);

    res.json(createApiResponse(
      true,
      {
        usage,
        limits,
        analysis
      },
      'Uso de recursos obtenido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTenantLimits = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const userId = req.userId!;

    // Verificar acceso
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess) {
      throw new NotFoundError('Empresa');
    }

    const limits = await subscriptionService.calculateTenantLimits(tenantId);

    res.json(createApiResponse(
      true,
      limits,
      'Límites obtenidos exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTenantSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const userId = req.userId!;

    // Verificar acceso y rol
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess || !['admin', 'manager'].includes(userAccess.rol)) {
      throw new AuthorizationError('No tienes permisos para ver la configuración');
    }

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Empresa');
    }

    const settings = tenant.configuracion || {};

    res.json(createApiResponse(
      true,
      settings,
      'Configuración obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateTenantSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const settings = req.body;
    const userId = req.userId!;

    // Verificar que es admin
    const userAccess = await userService.getUserTenantAccess(userId, tenantId);
    if (!userAccess || userAccess.rol !== UserRole.ADMIN) {
      throw new AuthorizationError('Solo administradores pueden actualizar la configuración');
    }

    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant) {
      throw new NotFoundError('Empresa');
    }

    // Merge con configuración existente
    const updatedSettings = {
      ...tenant.configuracion,
      ...settings
    };

    await tenantService.updateTenant(tenantId, {
      configuracion: updatedSettings
    });

    res.json(createApiResponse(
      true,
      updatedSettings,
      'Configuración actualizada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const requestTenantDeletion = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const { password, confirmation, reason } = req.body;
    const userId = req.userId!;

    // Verificar confirmación
    if (confirmation !== 'DELETE') {
      throw new ValidationError('Confirmación incorrecta');
    }

    // Verificar que es el owner
    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant || tenant.created_by !== userId) {
      throw new AuthorizationError('Solo el propietario puede eliminar la empresa');
    }

    // Verificar contraseña
    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    const authService = require('../services/auth.service').authService;
    const isValid = await authService.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new ValidationError('Contraseña incorrecta');
    }

    // Verificar que no hay suscripciones activas de pago
    const activeSubscriptions = await subscriptionService.getActivePaidSubscriptions(tenantId);
    if (activeSubscriptions.length > 0) {
      throw new ValidationError('Debes cancelar todas las suscripciones antes de eliminar la empresa');
    }

    // Programar eliminación (30 días)
    await tenantService.scheduleTenantDeletion(tenantId, reason);

    // Notificar a todos los miembros
    const members = await tenantService.getTenantMembers(tenantId);
    for (const member of members) {
      await notificationService.createNotification({
        user_id: member.usuario_id,
        type: 'warning',
        title: 'Empresa programada para eliminación',
        message: `La empresa ${tenant.nombre} será eliminada en 30 días`,
        data: {
          tenant_id: tenantId,
          deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'TENANT_DELETION_REQUESTED',
      details: {
        reason,
        scheduled_for: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        deletion_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      'Solicitud de eliminación procesada',
      'La empresa será eliminada en 30 días. Puedes cancelar esta solicitud en cualquier momento.'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const transferOwnership = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.params;
    const { newOwnerId, password } = req.body;
    const userId = req.userId!;

    // Verificar que es el owner actual
    const tenant = await tenantService.getTenantById(tenantId);
    if (!tenant || tenant.created_by !== userId) {
      throw new AuthorizationError('Solo el propietario puede transferir la empresa');
    }

    // Verificar contraseña
    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    const authService = require('../services/auth.service').authService;
    const isValid = await authService.verifyPassword(password, user.password_hash);
    if (!isValid) {
        throw new ValidationError('Contraseña incorrecta');
   }

   // Verificar que el nuevo owner es miembro del tenant
   const newOwnerAccess = await userService.getUserTenantAccess(newOwnerId, tenantId);
   if (!newOwnerAccess) {
     throw new ValidationError('El nuevo propietario debe ser miembro de la empresa');
   }

   // Transferir propiedad
   await tenantService.transferOwnership(tenantId, userId, newOwnerId);

   // Actualizar rol del nuevo owner a admin si no lo es
   if (newOwnerAccess.rol !== UserRole.ADMIN) {
     await tenantService.updateMemberRole(tenantId, newOwnerId, UserRole.ADMIN);
   }

   // Notificar al nuevo owner
   await notificationService.createNotification({
     user_id: newOwnerId,
     type: 'info',
     title: 'Transferencia de propiedad',
     message: `Ahora eres el propietario de ${tenant.nombre}`,
     data: {
       tenant_id: tenantId,
       previous_owner_id: userId
     }
   });

   // Log actividad
   await activityService.log({
     user_id: userId,
     tenant_id: tenantId,
     action: 'TENANT_OWNERSHIP_TRANSFERRED',
     details: {
       previous_owner_id: userId,
       new_owner_id: newOwnerId
     },
     ip_address: req.ip,
     user_agent: req.headers['user-agent'],
     success: true
   });

   res.json(createApiResponse(
     true,
     null,
     'Propiedad transferida exitosamente'
   ));
 } catch (error: any) {
   throw error;
 }
};
