import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { teamService } from '../services/team.service';
import { userService } from '../services/user.service';
import { tenantService } from '../services/tenant.service';
import { emailService } from '../services/email.service';
import { notificationService } from '../services/notification.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ACTIVITY_ACTIONS, UserRole, canManageRole } from '../constants';
import { 
  NotFoundError, 
  ValidationError, 
  AuthorizationError,
  ConflictError 
} from '../types';

export const getTeamMembers = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { page = 1, limit = 20, search, role, active } = req.query;

    const result = await teamService.getTeamMembers(tenantId, {
      page: Number(page),
      limit: Number(limit),
      search: search as string,
      role: role as string,
      activeOnly: active === 'true'
    });

    res.json(createApiResponse(
      true,
      result.members,
      'Miembros del equipo obtenidos',
      undefined,
      undefined,
      {
        pagination: result.pagination
      }
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getMemberById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { memberId } = req.params;
    const tenantId = req.tenantId!;

    const member = await teamService.getMemberDetails(tenantId, memberId);
    
    if (!member) {
      throw new NotFoundError('Miembro');
    }

    res.json(createApiResponse(
      true,
      member,
      'Detalles del miembro obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const inviteMember = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { identifier, rol, message, expires_in_hours = 72 } = req.body;

    // Verificar límite de usuarios del plan
    const memberCount = await tenantService.getMemberCount(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);
    
    if (limits.users && memberCount >= limits.users) {
      throw new ValidationError(
        `Has alcanzado el límite de ${limits.users} usuarios para tu plan actual`
      );
    }

    // Buscar usuario por identifier (email o teléfono)
    let targetUser = await userService.findByIdentifier(identifier);
    let isNewUser = false;

    if (!targetUser) {
      // Si no existe, crear invitación pendiente
      isNewUser = true;
    } else {
      // Verificar si ya es miembro
      const existingMember = await userService.getUserTenantAccess(
        targetUser.id,
        tenantId
      );

      if (existingMember) {
        if (existingMember.activo) {
          throw new ConflictError('El usuario ya es miembro del equipo');
        } else {
          // Reactivar miembro
          await teamService.reactivateMember(tenantId, targetUser.id);
          
          res.json(createApiResponse(
            true,
            {
              user_id: targetUser.id,
              reactivated: true
            },
            'Miembro reactivado exitosamente'
          ));
          return;
        }
      }
    }

    // Crear invitación
    const invitation = await teamService.createInvitation({
      tenant_id: tenantId,
      invited_by: userId,
      identifier,
      rol,
      message,
      expires_at: new Date(Date.now() + expires_in_hours * 60 * 60 * 1000)
    });

    // Enviar invitación por email o SMS
    const tenant = await tenantService.getTenantById(tenantId);
    const inviter = await userService.findById(userId);

    if (identifier.includes('@')) {
      await emailService.sendTeamInvitation({
        email: identifier,
        inviterName: `${inviter!.nombre} ${inviter!.apellido}`,
        tenantName: tenant!.nombre,
        message,
        invitationToken: invitation.token
      });
    } else {
      // TODO: Implementar SMS
      logger.info({
        phone: identifier,
        invitationId: invitation.id
      }, 'SMS invitation not implemented yet');
    }

    // Si el usuario existe, también crear notificación
    if (targetUser) {
      await notificationService.createNotification({
        user_id: targetUser.id,
        type: 'team_invite',
        title: 'Invitación a equipo',
        message: `Has sido invitado a unirte a ${tenant!.nombre}`,
        data: {
          tenant_id: tenantId,
          invitation_id: invitation.id,
          inviter_name: `${inviter!.nombre} ${inviter!.apellido}`
        }
      });
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.INVITATION_SENT,
      details: {
        invited_identifier: identifier,
        role: rol,
        is_new_user: isNewUser
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        invitation_id: invitation.id,
        expires_at: invitation.expires_at,
        is_new_user: isNewUser
      },
      'Invitación enviada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const bulkInvite = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { invitations, message } = req.body;

    // Verificar límite de usuarios
    const currentCount = await tenantService.getMemberCount(tenantId);
    const limits = await subscriptionService.calculateTenantLimits(tenantId);
    const newTotal = currentCount + invitations.length;
    
    if (limits.users && newTotal > limits.users) {
      throw new ValidationError(
        `Agregar ${invitations.length} usuarios excedería el límite de ${limits.users} usuarios`
      );
    }

    const results = await teamService.bulkInvite(
      tenantId,
      userId,
      invitations,
      message
    );

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'BULK_INVITATIONS_SENT',
      details: {
        total_invitations: invitations.length,
        successful: results.successful.length,
        failed: results.failed.length
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      results,
      `${results.successful.length} invitaciones enviadas exitosamente`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateMember = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { memberId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const updates = req.body;

    // Obtener roles actuales
    const currentUserRole = req.userRole!;
    const memberAccess = await userService.getUserTenantAccess(memberId, tenantId);
    
    if (!memberAccess) {
      throw new NotFoundError('Miembro');
    }

    // Verificar permisos para cambiar rol
    if (updates.rol) {
      if (!canManageRole(currentUserRole as any, memberAccess.rol as any)) {
        throw new AuthorizationError('No puedes gestionar usuarios con este rol');
      }
      
      if (!canManageRole(currentUserRole as any, updates.rol)) {
        throw new AuthorizationError('No puedes asignar este rol');
      }
    }

    // No permitir que el owner se quite el rol de admin
    const tenant = await tenantService.getTenantById(tenantId);
    if (tenant!.created_by === memberId && updates.rol !== UserRole.ADMIN) {
      throw new ValidationError('El propietario siempre debe ser administrador');
    }

    // Actualizar miembro
    await teamService.updateMember(tenantId, memberId, updates);

    // Notificar al miembro si hubo cambios importantes
    if (updates.rol || updates.activo === false) {
      await notificationService.createNotification({
        user_id: memberId,
        type: 'team_update',
        title: 'Cambios en tu rol',
        message: updates.rol 
          ? `Tu rol ha sido cambiado a ${updates.rol}` 
          : 'Tu acceso ha sido modificado',
        data: {
          tenant_id: tenantId,
          changes: updates
        }
      });
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.MEMBER_UPDATED,
      resource_type: 'user',
      resource_id: memberId,
      details: {
        changes: updates,
        previous_role: memberAccess.rol
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Miembro actualizado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const removeMember = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { memberId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    // No permitir que el owner se elimine a sí mismo
    const tenant = await tenantService.getTenantById(tenantId);
    if (tenant!.created_by === memberId) {
      throw new ValidationError('El propietario no puede ser removido del equipo');
    }

    // No permitir auto-eliminación
    if (memberId === userId) {
      throw new ValidationError('No puedes removerte a ti mismo. Usa la opción de salir del equipo.');
    }

    // Verificar que el miembro existe
    const memberAccess = await userService.getUserTenantAccess(memberId, tenantId);
    if (!memberAccess) {
      throw new NotFoundError('Miembro');
    }

    // Remover miembro (soft delete)
    await teamService.removeMember(tenantId, memberId);

    // Notificar al miembro removido
    const memberUser = await userService.findById(memberId);
    await notificationService.createNotification({
      user_id: memberId,
      type: 'team_removal',
      title: 'Removido del equipo',
      message: `Has sido removido del equipo de ${tenant!.nombre}`,
      data: {
        tenant_id: tenantId,
        tenant_name: tenant!.nombre
      }
    });

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.MEMBER_REMOVED,
      resource_type: 'user',
      resource_id: memberId,
      details: {
        member_name: `${memberUser!.nombre} ${memberUser!.apellido}`,
        member_role: memberAccess.rol
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Miembro removido exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getPendingInvitations = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;

    const invitations = await teamService.getPendingInvitations(tenantId);

    res.json(createApiResponse(
      true,
      invitations,
      'Invitaciones pendientes obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const cancelInvitation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { invitationId } = req.params;
    const tenantId = req.tenantId!;
    const userId = req.userId!;

    await teamService.cancelInvitation(invitationId, tenantId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'INVITATION_CANCELED',
      resource_id: invitationId,
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Invitación cancelada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const resendInvitation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { invitationId } = req.params;
    const tenantId = req.tenantId!;

    const invitation = await teamService.resendInvitation(invitationId, tenantId);

    res.json(createApiResponse(
      true,
      {
        expires_at: invitation.expires_at
      },
      'Invitación reenviada'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const acceptInvitation = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { token } = req.body;

    const result = await teamService.acceptInvitation(token);

    // Log actividad
    await activityService.log({
      user_id: result.user_id,
      tenant_id: result.tenant_id,
      action: ACTIVITY_ACTIONS.INVITATION_ACCEPTED,
      details: {
        role: result.role
      },
      success: true
    });

    res.json(createApiResponse(
      true,
      result,
      'Invitación aceptada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAvailablePermissions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const permissions = teamService.getAvailablePermissions();

    res.json(createApiResponse(
      true,
      permissions,
      'Permisos disponibles obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAvailableRoles = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const roles = teamService.getAvailableRoles();

    res.json(createApiResponse(
      true,
      roles,
      'Roles disponibles obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};
