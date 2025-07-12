import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { userService } from '../services/user.service';
import { fileService } from '../services/file.service';
import { activityService } from '../services/activity.service';
import { notificationService } from '../services/notification.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS } from '../constants';
import { NotFoundError, ValidationError } from '../types';

export const getProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const user = await userService.getFullProfile(userId);
    
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    res.json(createApiResponse(
      true,
      user,
      'Perfil obtenido exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateProfile = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const updates = req.body;

    // Si se está cambiando el email, verificar que no exista
    if (updates.email) {
      const existingUser = await userService.findByEmail(updates.email);
      if (existingUser && existingUser.id !== userId) {
        throw new ValidationError('El email ya está en uso');
      }
    }

    // Si se está cambiando el teléfono, verificar que no exista
    if (updates.telefono) {
      const existingUser = await userService.findByPhone(updates.telefono);
      if (existingUser && existingUser.id !== userId) {
        throw new ValidationError('El teléfono ya está registrado');
      }
    }

    const updatedUser = await userService.updateProfile(userId, updates);

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.PROFILE_UPDATED,
      details: {
        fields_updated: Object.keys(updates)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedUser,
      'Perfil actualizado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      throw new ValidationError('No se proporcionó archivo');
    }

    // Validar tipo de archivo
    if (!file.mimetype.startsWith('image/')) {
      throw new ValidationError('El archivo debe ser una imagen');
    }

    // Subir archivo
    const uploadedFile = await fileService.uploadAvatar(
      userId,
      file,
      req.tenantId
    );

    // Actualizar URL del avatar en el perfil
    await userService.updateProfile(userId, {
      avatar_url: uploadedFile.public_url
    });

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.AVATAR_UPDATED,
      details: {
        file_id: uploadedFile.id,
        file_size: file.size,
        mime_type: file.mimetype
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        avatar_url: uploadedFile.public_url,
        file_id: uploadedFile.id
      },
      'Avatar actualizado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const deleteAvatar = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const user = await userService.findById(userId);
    if (!user || !user.avatar_url) {
      throw new NotFoundError('Avatar');
    }

    // Eliminar archivo de storage
    if (user.avatar_file_id) {
      await fileService.deleteFile(user.avatar_file_id, userId);
    }

    // Actualizar perfil
    await userService.updateProfile(userId, {
      avatar_url: null,
      avatar_file_id: null
    });

    res.json(createApiResponse(
      true,
      null,
      'Avatar eliminado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    const settings = user.settings || {
      theme: 'light',
      language: 'es',
      timezone: 'America/Panama',
      notifications: {
        email: true,
        push: true,
        sms: false,
        marketing: false
      }
    };

    res.json(createApiResponse(
      true,
      settings,
      'Configuraciones obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateSettings = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const settings = req.body;

    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    // Merge con settings existentes
    const updatedSettings = {
      ...user.settings,
      ...settings,
      notifications: {
        ...user.settings?.notifications,
        ...settings.notifications
      }
    };

    await userService.updateProfile(userId, {
      settings: updatedSettings
    });

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.SETTINGS_UPDATED,
      details: {
        updated_fields: Object.keys(settings)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      updatedSettings,
      'Configuraciones actualizadas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getUserTenants = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const tenants = await userService.getUserTenants(userId);

    const formattedTenants = tenants.map(ut => ({
      id: ut.tenant.id,
      nombre: ut.tenant.nombre,
      logo_url: ut.tenant.logo_url,
      rol: ut.rol,
      joined_at: ut.joined_at,
      is_owner: ut.tenant.created_by === userId,
      is_active: ut.activo && ut.tenant.activo,
      subscription_status: ut.tenant.subscription_status
    }));

    res.json(createApiResponse(
      true,
      formattedTenants,
      'Empresas obtenidas exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getNotificationPreferences = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    const preferences = await notificationService.getUserPreferences(userId);

    res.json(createApiResponse(
      true,
      preferences,
      'Preferencias de notificaciones obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateNotificationPreferences = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const preferences = req.body;

    await notificationService.updateUserPreferences(userId, preferences);

    res.json(createApiResponse(
      true,
      preferences,
      'Preferencias actualizadas exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const requestAccountDeletion = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { password, confirmation, reason } = req.body;

    // Verificar confirmación
    if (confirmation !== 'DELETE') {
      throw new ValidationError('Confirmación incorrecta');
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

    // Programar eliminación (30 días)
    await userService.scheduleAccountDeletion(userId, reason);

    // Enviar email de confirmación
    const emailService = require('../services/email.service').emailService;
    await emailService.sendAccountDeletionEmail(user);

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: 'ACCOUNT_DELETION_REQUESTED',
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
      'Tu cuenta será eliminada en 30 días. Puedes cancelar esta solicitud en cualquier momento.'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const exportUserData = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    
    // Recopilar todos los datos del usuario
    const userData = await userService.exportUserData(userId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: 'USER_DATA_EXPORTED',
      details: {
        format: 'json',
        sections: Object.keys(userData)
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      userData,
      'Datos exportados exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getUserById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { tenantId } = req.query;
    const requestingUserId = req.userId!;

    // Verificar que ambos usuarios pertenecen al mismo tenant
    if (tenantId) {
      const requesterAccess = await userService.getUserTenantAccess(
        requestingUserId,
        tenantId as string
      );
      const targetAccess = await userService.getUserTenantAccess(
        userId,
        tenantId as string
      );

      if (!requesterAccess || !targetAccess) {
        throw new NotFoundError('Usuario');
      }
    }

    const user = await userService.getPublicProfile(userId);
    
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    res.json(createApiResponse(
      true,
      user,
      'Usuario obtenido exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const searchUsers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { q, tenantId, limit = 10 } = req.query;
    const userId = req.userId!;

    if (!tenantId) {
      throw new ValidationError('Se requiere especificar el tenant');
    }

    // Verificar acceso al tenant
    const access = await userService.getUserTenantAccess(
      userId,
      tenantId as string
    );

    if (!access) {
      throw new NotFoundError('Tenant');
    }

    const users = await userService.searchUsersInTenant(
      tenantId as string,
      q as string,
      Number(limit)
    );

    res.json(createApiResponse(
      true,
      users,
      'Búsqueda completada'
    ));
  } catch (error: any) {
    throw error;
  }
};
