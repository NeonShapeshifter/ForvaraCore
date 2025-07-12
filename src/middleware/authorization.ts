import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { UserRole, hasRole as checkHasRole, hasPermission as checkHasPermission } from '../constants/roles';
import { ErrorCode } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      logger.warn({ 
        userId: req.userId,
        requestId: req.requestId
      }, 'No user role found');
      
      res.status(403).json(createApiResponse(
        false,
        null,
        'Rol no encontrado',
        'No se pudo determinar el rol del usuario',
        ErrorCode.FORBIDDEN
      ));
      return;
    }

    if (!allowedRoles.includes(req.userRole)) {
      logger.warn({ 
        userId: req.userId,
        userRole: req.userRole,
        requiredRoles: allowedRoles,
        requestId: req.requestId
      }, 'Insufficient role permissions');
      
      res.status(403).json(createApiResponse(
        false,
        null,
        'Permisos insuficientes',
        `Se requiere uno de los siguientes roles: ${allowedRoles.join(', ')}`,
        ErrorCode.INSUFFICIENT_PERMISSIONS
      ));
      return;
    }

    next();
  };
};

export const hasPermission = (requiredPermission: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      res.status(403).json(createApiResponse(
        false,
        null,
        'Rol no encontrado',
        'No se pudo determinar el rol del usuario',
        ErrorCode.FORBIDDEN
      ));
      return;
    }

    if (!checkHasPermission(req.userRole as any, requiredPermission)) {
      logger.warn({ 
        userId: req.userId,
        userRole: req.userRole,
        requiredPermission,
        requestId: req.requestId
      }, 'Insufficient permissions');
      
      res.status(403).json(createApiResponse(
        false,
        null,
        'Permiso denegado',
        `No tienes el permiso requerido: ${requiredPermission}`,
        ErrorCode.INSUFFICIENT_PERMISSIONS
      ));
      return;
    }

    next();
  };
};

export const requireMinRole = (minRole: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole) {
      res.status(403).json(createApiResponse(
        false,
        null,
        'Rol no encontrado',
        'No se pudo determinar el rol del usuario',
        ErrorCode.FORBIDDEN
      ));
      return;
    }

    if (!checkHasRole(req.userRole as any, minRole as any)) {
      logger.warn({ 
        userId: req.userId,
        userRole: req.userRole,
        minRole,
        requestId: req.requestId
      }, 'Role hierarchy check failed');
      
      res.status(403).json(createApiResponse(
        false,
        null,
        'Rol insuficiente',
        `Se requiere rol mínimo de: ${minRole}`,
        ErrorCode.INSUFFICIENT_PERMISSIONS
      ));
      return;
    }

    next();
  };
};

// Middleware para verificar si el usuario puede gestionar a otro usuario
export const canManageUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const targetUserId = req.params.userId || req.body.userId;
    
    if (!targetUserId) {
      res.status(400).json(createApiResponse(
        false,
        null,
        'Usuario objetivo no especificado',
        'Debe especificar el ID del usuario a gestionar',
        ErrorCode.VALIDATION_ERROR
      ));
      return;
    }

    // Si es el mismo usuario, puede gestionarse
    if (targetUserId === req.userId) {
      return next();
    }

    // Si es super admin, puede gestionar a todos
    if (req.userRole === UserRole.SUPER_ADMIN) {
      return next();
    }

    // Verificar rol del usuario objetivo
    const { getSupabase } = require('../config/database');
    const supabase = getSupabase();
    
    const { data: targetUserTenant } = await supabase
      .from('user_tenants')
      .select('rol')
      .eq('usuario_id', targetUserId)
      .eq('tenant_id', req.tenantId)
      .single();

    if (!targetUserTenant) {
      res.status(404).json(createApiResponse(
        false,
        null,
        'Usuario no encontrado',
        'El usuario no existe en esta empresa',
        ErrorCode.USER_NOT_FOUND
      ));
      return;
    }

    // Verificar jerarquía de roles
    const { canManageRole } = require('../constants/roles');
    if (!canManageRole(req.userRole as any, targetUserTenant.rol as any)) {
      res.status(403).json(createApiResponse(
        false,
        null,
        'No puedes gestionar este usuario',
        'No tienes permisos para gestionar usuarios con este rol',
        ErrorCode.INSUFFICIENT_PERMISSIONS
      ));
      return;
    }

    next();
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      userId: req.userId,
      targetUserId: req.params.userId || req.body.userId,
      requestId: req.requestId
    }, 'Error checking user management permissions');
    
    res.status(500).json(createApiResponse(
      false,
      null,
      'Error al verificar permisos',
      'Error interno al verificar permisos de gestión',
      ErrorCode.INTERNAL_ERROR
    ));
  }
};
