import rateLimit, { Options } from 'express-rate-limit';
import { Request, Response } from 'express';
import { RateLimiterStore } from '../config/redis';
import { config } from '../config';
import { ErrorCode } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';

const rateLimiterStore = new RateLimiterStore();

// Store personalizado para Redis
class RedisStore {
  async increment(key: string): Promise<{ totalHits: number; resetTime?: Date }> {
    const totalHits = await rateLimiterStore.increment(
      key,
      config.RATE_LIMIT_WINDOW_MS
    );
    
    return {
      totalHits,
      resetTime: new Date(Date.now() + config.RATE_LIMIT_WINDOW_MS)
    };
  }

  async decrement(key: string): Promise<void> {
    // No implementado, no es necesario para nuestro uso
  }

  async resetKey(key: string): Promise<void> {
    await rateLimiterStore.reset(key);
  }
}

// Configuración base para rate limiters
const createRateLimiterOptions = (
  windowMs: number,
  max: number,
  message: string,
  keyGenerator?: (req: Request) => string
): Partial<Options> => ({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore() as any,
  keyGenerator: keyGenerator || ((req) => {
    const userId = (req as any).userId;
    const identifier = userId || req.ip;
    return `${identifier}`;
  }),
  handler: (req: Request, res: Response) => {
    logger.warn({
      ip: req.ip,
      userId: (req as any).userId,
      path: req.path,
      requestId: (req as any).requestId
    }, 'Rate limit exceeded');
    
    res.status(429).json(createApiResponse(
      false,
      null,
      message,
      `Has excedido el límite de ${max} peticiones por ${windowMs / 1000 / 60} minutos`,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      {
        limit: max,
        windowMs,
        retryAfter: res.getHeader('Retry-After')
      }
    ));
  },
  skip: (req) => {
    // Skip rate limiting en desarrollo/test
    if (config.NODE_ENV !== 'production') {
      return true;
    }
    
    // Skip para health checks
    if (req.path === '/health' || req.path === '/metrics') {
      return true;
    }
    
    return false;
  }
});

// Rate limiter para autenticación (más estricto)
export const authLimiter = rateLimit(createRateLimiterOptions(
  15 * 60 * 1000, // 15 minutos
  5, // 5 intentos
  'Demasiados intentos de autenticación',
  (req) => `auth:${req.ip}` // Por IP, no por usuario
));

// Rate limiter general para API
export const apiLimiter = rateLimit(createRateLimiterOptions(
  config.RATE_LIMIT_WINDOW_MS,
  config.RATE_LIMIT_MAX_REQUESTS,
  'Límite de peticiones excedido'
));

// Rate limiter para uploads
export const uploadLimiter = rateLimit(createRateLimiterOptions(
  60 * 60 * 1000, // 1 hora
  20, // 20 uploads por hora
  'Demasiados archivos subidos'
));

// Rate limiter para endpoints costosos
export const expensiveLimiter = rateLimit(createRateLimiterOptions(
  60 * 60 * 1000, // 1 hora
  10, // 10 peticiones por hora
  'Límite de operaciones costosas excedido'
));

// Rate limiter por tenant
export const tenantRateLimiter = rateLimit(createRateLimiterOptions(
  60 * 1000, // 1 minuto
  100, // 100 peticiones por minuto
  'Límite de peticiones del tenant excedido',
  (req) => {
    const tenantId = (req as any).tenantId;
    return tenantId ? `tenant:${tenantId}` : `ip:${req.ip}`;
  }
));

// Función para crear rate limiter personalizado
export const createRateLimiter = (
  windowMs: number,
  max: number,
  message: string = 'Demasiadas peticiones'
) => {
  return rateLimit(createRateLimiterOptions(windowMs, max, message));
};

// Middleware para verificar límites basados en suscripción
export const subscriptionRateLimiter = async (
  req: Request & { tenantId?: string; tenant?: any },
  res: Response,
  next: Function
): Promise<void> => {
  try {
    if (!req.tenantId) {
      return next();
    }

    // Obtener límites del tenant
    const { calculateTenantLimits } = require('../services/subscription.service');
    const limits = await calculateTenantLimits(req.tenantId);
    
    const key = `api:${req.tenantId}`;
    const currentCount = await rateLimiterStore.increment(
      key,
      60 * 60 * 1000 // 1 hora
    );
    
    const limit = limits.api_calls_per_hour || 1000;
    
    // Añadir headers
    res.setHeader('X-RateLimit-Limit', limit.toString());
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - currentCount).toString());
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60 * 60 * 1000).toISOString());

    if (currentCount > limit) {
      logger.warn({
        tenantId: req.tenantId,
        currentCount,
        limit,
        requestId: (req as any).requestId
      }, 'Tenant API limit exceeded');

      res.status(429).json(createApiResponse(
        false,
        null,
        'Límite de API excedido',
        `Has alcanzado el límite de ${limit} llamadas por hora para tu plan`,
        ErrorCode.API_LIMIT_EXCEEDED,
        {
          limit,
          current: currentCount,
          resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          upgradePlan: true
        }
      ));
      return;
    }

    next();
  } catch (error) {
    logger.error({
      error,
      tenantId: req.tenantId,
      requestId: (req as any).requestId
    }, 'Subscription rate limiter error');

    // En caso de error, permitir continuar
    next();
  }
};
