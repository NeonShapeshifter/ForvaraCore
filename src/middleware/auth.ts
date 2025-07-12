import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../config/logger';
import { getSupabase } from '../config/database';
import { SessionStore } from '../config/redis';
import { AuthenticatedRequest, JwtPayload } from '../types';
import { ErrorCode } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { logActivity } from '../services/activity.service';

const sessionStore = new SessionStore();

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      logger.warn({ 
        ip: req.ip, 
        path: req.path,
        requestId: req.requestId 
      }, 'Missing authentication token');
      
      res.status(401).json(createApiResponse(
        false,
        null,
        'Token de autenticación requerido',
        'No se proporcionó token de autenticación',
        ErrorCode.UNAUTHORIZED
      ));
      return;
    }

    let decoded: JwtPayload;
    
    try {
      decoded = jwt.verify(token, config.JWT_SECRET, {
        issuer: 'forvara-core',
        audience: 'forvara-apps'
      }) as JwtPayload;
    } catch (jwtError: any) {
      logger.warn({ 
        error: jwtError.message,
        ip: req.ip,
        requestId: req.requestId 
      }, 'Invalid JWT token');
      
      const errorCode = jwtError.name === 'TokenExpiredError' 
        ? ErrorCode.TOKEN_EXPIRED 
        : ErrorCode.TOKEN_INVALID;
      
      res.status(401).json(createApiResponse(
        false,
        null,
        'Token inválido',
        jwtError.message,
        errorCode
      ));
      return;
    }

    // Verificar sesión en Redis
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const session = await sessionStore.get(decoded.sessionId || tokenHash);

    if (!session) {
      // Fallback a base de datos si no está en Redis
      const supabase = getSupabase();
      const { data: dbSession } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('token_hash', tokenHash)
        .eq('user_id', decoded.userId)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (!dbSession) {
        logger.warn({ 
          userId: decoded.userId,
          requestId: req.requestId 
        }, 'Session not found or expired');
        
        res.status(401).json(createApiResponse(
          false,
          null,
          'Sesión expirada',
          'La sesión ha expirado, inicia sesión nuevamente',
          ErrorCode.SESSION_EXPIRED
        ));
        return;
      }

      // Guardar en Redis para próximas requests
      await sessionStore.set(decoded.sessionId || tokenHash, dbSession);
    }

    // Verificar que el usuario existe y está activo
    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .eq('activo', true)
      .is('deleted_at', null)
      .single();

    if (error || !user) {
      logger.warn({ 
        userId: decoded.userId,
        error: error?.message,
        requestId: req.requestId 
      }, 'User not found or inactive');
      
      res.status(401).json(createApiResponse(
        false,
        null,
        'Usuario no válido',
        'El usuario no existe o está inactivo',
        ErrorCode.USER_NOT_FOUND
      ));
      return;
    }

    // Validaciones de seguridad adicionales en producción
    if (config.NODE_ENV === 'production' && session) {
      // Verificar cambio sospechoso de IP
      if (session.ip_address && session.ip_address !== req.ip) {
        logger.warn({ 
          userId: decoded.userId,
          sessionIp: session.ip_address,
          currentIp: req.ip,
          requestId: req.requestId
        }, 'Suspicious IP change detected');
        
        // Log activity pero no bloquear (podría ser VPN, etc)
        await logActivity({
          user_id: decoded.userId,
          action: 'SUSPICIOUS_IP_CHANGE',
          details: { 
            from: session.ip_address, 
            to: req.ip,
            user_agent: req.headers['user-agent']
          },
          ip_address: req.ip,
          user_agent: req.headers['user-agent'],
          success: false,
          request_id: req.requestId
        });
      }
    }

    // Actualizar última actividad (throttled)
    const lastActivity = new Date(session?.last_activity || 0);
    const now = new Date();
    const timeDiff = now.getTime() - lastActivity.getTime();
    
    // Solo actualizar si han pasado más de 5 minutos
    if (timeDiff > 5 * 60 * 1000) {
      await sessionStore.touch(decoded.sessionId || tokenHash);
      
      // Actualizar en DB también (async, sin esperar)
      supabase
        .from('user_sessions')
        .update({ 
          last_activity: now.toISOString(),
          last_ip: req.ip
        })
        .eq('token_hash', tokenHash)
        .then(() => {
          logger.debug({ userId: decoded.userId }, 'Session activity updated');
        })
        .catch((error) => {
          logger.error({ error, userId: decoded.userId }, 'Failed to update session activity');
        });
    }

    // Si hay tenantId en el token, verificar acceso
    if (decoded.tenantId) {
      const { data: userTenant } = await supabase
        .from('user_tenants')
        .select('rol, activo')
        .eq('usuario_id', decoded.userId)
        .eq('tenant_id', decoded.tenantId)
        .is('deleted_at', null)
        .single();

      if (!userTenant || !userTenant.activo) {
        logger.warn({ 
          userId: decoded.userId,
          tenantId: decoded.tenantId,
          requestId: req.requestId
        }, 'User has no active access to tenant');
        
        res.status(403).json(createApiResponse(
          false,
          null,
          'Sin acceso al tenant',
          'No tienes acceso activo a esta empresa',
          ErrorCode.TENANT_ACCESS_DENIED
        ));
        return;
      }

      req.userRole = userTenant.rol;
    }

    // Establecer datos en request
    req.userId = decoded.userId;
    req.tenantId = decoded.tenantId;
    req.user = user;

    next();
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      stack: error.stack,
      requestId: req.requestId
    }, 'Authentication middleware error');
    
    res.status(500).json(createApiResponse(
      false,
      null,
      'Error de autenticación',
      'Error interno durante la autenticación',
      ErrorCode.INTERNAL_ERROR
    ));
  }
};

// Middleware opcional de autenticación (no bloquea si no hay token)
export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return next();
  }

  // Intentar autenticar pero no bloquear si falla
  try {
    await authenticateToken(req, res, () => {
      next();
    });
  } catch (error) {
    logger.debug({ error }, 'Optional auth failed, continuing without auth');
    next();
  }
};

// Verificar API Key para servicios externos
export const authenticateApiKey = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      res.status(401).json(createApiResponse(
        false,
        null,
        'API Key requerida',
        'No se proporcionó API Key',
        ErrorCode.UNAUTHORIZED
      ));
      return;
    }

    // TODO: Implementar verificación de API Key
    // Por ahora, verificar contra una lista en config o DB
    const supabase = getSupabase();
    const { data: app } = await supabase
      .from('api_keys')
      .select('app_id, tenant_id, permissions')
      .eq('key_hash', crypto.createHash('sha256').update(apiKey).digest('hex'))
      .eq('active', true)
      .single();

    if (!app) {
      res.status(401).json(createApiResponse(
        false,
        null,
        'API Key inválida',
        'La API Key proporcionada no es válida',
        ErrorCode.UNAUTHORIZED
      ));
      return;
    }

    // Establecer contexto de la app
    req.tenantId = app.tenant_id;
    next();
  } catch (error: any) {
    logger.error({ error, requestId: req.requestId }, 'API Key authentication error');
    
    res.status(500).json(createApiResponse(
      false,
      null,
      'Error de autenticación',
      'Error al verificar API Key',
      ErrorCode.INTERNAL_ERROR
    ));
  }
};
