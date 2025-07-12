import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { getSupabase } from '../config/database';
import { CacheService } from '../config/redis';
import { ErrorCode } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { CACHE_KEYS } from '../constants';

const tenantCache = new CacheService('tenant', 300); // 5 minutos

export const injectTenant = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Si no hay tenantId, continuar
    if (!req.tenantId) {
      return next();
    }

    // Intentar obtener de caché
    const cacheKey = CACHE_KEYS.TENANT(req.tenantId);
    const cachedTenant = await tenantCache.get(cacheKey);
    
    if (cachedTenant) {
      req.tenant = cachedTenant;
      return next();
    }

    // Obtener de base de datos
    const supabase = getSupabase();
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', req.tenantId)
      .eq('activo', true)
      .is('deleted_at', null)
      .single();

    if (error || !tenant) {
      logger.warn({
        tenantId: req.tenantId,
        error: error?.message,
        requestId: req.requestId
      }, 'Tenant not found or inactive');
      
      res.status(404).json(createApiResponse(
        false,
        null,
        'Empresa no encontrada',
        'La empresa no existe o está inactiva',
        ErrorCode.TENANT_ACCESS_DENIED
      ));
      return;
    }

    // Guardar en caché
    await tenantCache.set(cacheKey, tenant);
    
    req.tenant = tenant;
    next();
  } catch (error: any) {
    logger.error({
      error: error.message,
      tenantId: req.tenantId,
      requestId: req.requestId
    }, 'Error injecting tenant');
    
    res.status(500).json(createApiResponse(
      false,
      null,
      'Error interno',
      'Error al verificar acceso a la empresa',
      ErrorCode.INTERNAL_ERROR
    ));
  }
};

export const requireTenant = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.tenantId) {
    res.status(400).json(createApiResponse(
      false,
      null,
      'Tenant requerido',
      'Debe seleccionar una empresa para continuar',
      ErrorCode.VALIDATION_ERROR
    ));
    return;
  }

  if (!req.tenant) {
    res.status(404).json(createApiResponse(
      false,
      null,
      'Empresa no encontrada',
      'La empresa seleccionada no existe',
      ErrorCode.TENANT_ACCESS_DENIED
    ));
    return;
  }

  next();
};

// Verificar que el usuario pertenece al tenant
export const verifyTenantAccess = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.userId || !req.tenantId) {
      res.status(403).json(createApiResponse(
        false,
        null,
        'Acceso denegado',
        'Usuario o empresa no especificados',
        ErrorCode.FORBIDDEN
      ));
      return;
    }

    const supabase = getSupabase();
    const { data: userTenant } = await supabase
      .from('user_tenants')
      .select('rol, activo')
      .eq('usuario_id', req.userId)
      .eq('tenant_id', req.tenantId)
      .eq('activo', true)
      .is('deleted_at', null)
      .single();

    if (!userTenant) {
      logger.warn({
        userId: req.userId,
        tenantId: req.tenantId,
        requestId: req.requestId
      }, 'User does not belong to tenant');
      
      res.status(403).json(createApiResponse(
        false,
        null,
        'Sin acceso a la empresa',
        'No tienes acceso a esta empresa',
        ErrorCode.TENANT_ACCESS_DENIED
      ));
      return;
    }

    req.userRole = userTenant.rol;
    next();
  } catch (error: any) {
    logger.error({
      error: error.message,
      userId: req.userId,
      tenantId: req.tenantId,
      requestId: req.requestId
    }, 'Error verifying tenant access');
    
    res.status(500).json(createApiResponse(
      false,
      null,
      'Error de verificación',
      'Error al verificar acceso a la empresa',
      ErrorCode.INTERNAL_ERROR
    ));
  }
};

// Obtener tenant desde header o query
export const extractTenant = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Prioridad: header > query > body
  const tenantId = req.headers['x-tenant-id'] as string || 
                   req.query.tenantId as string || 
                   req.body?.tenantId;

  if (tenantId) {
    req.tenantId = tenantId;
  }

  next();
};
