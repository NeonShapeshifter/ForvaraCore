import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';
import { logger } from '../config/logger';
import { ErrorCode, getErrorMessage } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { 
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError
} from '../types';

interface ErrorResponse {
  statusCode: number;
  code: ErrorCode;
  message: string;
  details?: any;
}

const getErrorResponse = (error: any): ErrorResponse => {
  // Errores personalizados con ApiError interface
  if (error.statusCode && error.code) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message || getErrorMessage(error.code),
      details: error.details
    };
  }

  // Zod validation errors
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Errores de validación encontrados',
      details: {
        errors: error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }))
      }
    };
  }

  // Error de base de datos
  if (error.code === 'PGRST116') {
    return {
      statusCode: 404,
      code: ErrorCode.RESOURCE_NOT_FOUND,
      message: 'Recurso no encontrado'
    };
  }

  if (error.code === '23505') { // Unique violation
    return {
      statusCode: 409,
      code: ErrorCode.RESOURCE_ALREADY_EXISTS,
      message: 'El recurso ya existe'
    };
  }

  if (error.code === '23503') { // Foreign key violation
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Referencia inválida'
    };
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return {
      statusCode: 401,
      code: ErrorCode.TOKEN_INVALID,
      message: 'Token inválido'
    };
  }

  if (error.name === 'TokenExpiredError') {
    return {
      statusCode: 401,
      code: ErrorCode.TOKEN_EXPIRED,
      message: 'Token expirado'
    };
  }

  // Multer errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return {
      statusCode: 413,
      code: ErrorCode.FILE_TOO_LARGE,
      message: `Archivo demasiado grande. Máximo: ${config.MAX_FILE_SIZE / 1024 / 1024}MB`
    };
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      statusCode: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Campo de archivo inesperado'
    };
  }

  // Stripe errors
  if (error.type?.includes('Stripe')) {
    return {
      statusCode: 402,
      code: ErrorCode.PAYMENT_FAILED,
      message: 'Error en el procesamiento del pago',
      details: {
        stripe_error: error.code,
        decline_code: error.decline_code
      }
    };
  }

  // Default error
  return {
    statusCode: 500,
    code: ErrorCode.INTERNAL_ERROR,
    message: 'Error interno del servidor'
  };
};

export const errorHandler = (
  err: Error | ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const requestId = (req as any).requestId;
  const startTime = (req as any).startTime;
  const duration = startTime ? performance.now() - startTime : 0;

  // Obtener respuesta de error
  const errorResponse = getErrorResponse(err);

  // Log del error
  const logData = {
    error: err.message,
    stack: err.stack,
    code: errorResponse.code,
    statusCode: errorResponse.statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    userId: (req as any).userId,
    tenantId: (req as any).tenantId,
    requestId,
    duration: Math.round(duration),
    ...(config.NODE_ENV === 'development' && {
      body: req.body,
      query: req.query,
      params: req.params
    })
  };

  // Determinar nivel de log
  if (errorResponse.statusCode >= 500) {
    logger.error(logData, 'Server error');
  } else if (errorResponse.statusCode >= 400) {
    logger.warn(logData, 'Client error');
  } else {
    logger.info(logData, 'Handled error');
  }

  // No exponer detalles en producción para errores 500
  const message = config.NODE_ENV === 'production' && errorResponse.statusCode >= 500
    ? 'Error interno del servidor'
    : errorResponse.message;

  const details = config.NODE_ENV === 'production' && errorResponse.statusCode >= 500
    ? undefined
    : errorResponse.details;

  // Enviar respuesta
  res.status(errorResponse.statusCode).json(createApiResponse(
    false,
    null,
    message,
    err.message !== message ? err.message : undefined,
    errorResponse.code,
    {
      ...(details && { details }),
      ...(config.NODE_ENV !== 'production' && {
        stack: err.stack,
        requestId
      }),
      timestamp: new Date().toISOString()
    }
  ));
};

// Middleware para manejar errores asíncronos
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Middleware para capturar errores 404
export const notFoundHandler = (req: Request, res: Response): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path}`);
  
  logger.warn({
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: (req as any).requestId
  }, 'Route not found');
  
  res.status(404).json(createApiResponse(
    false,
    null,
    'Ruta no encontrada',
    `La ruta ${req.method} ${req.path} no existe`,
    ErrorCode.ROUTE_NOT_FOUND,
    {
      availableEndpoints: [
        'GET /health',
        'GET /api-docs',
        'POST /api/auth/login',
        'POST /api/auth/register',
        'GET /api/hub/dashboard'
      ]
    }
  ));
};

// Factory para crear errores custom
export const createError = (
  code: ErrorCode,
  message?: string,
  statusCode?: number,
  details?: any
): ApiError => {
  const error = new Error(message || getErrorMessage(code)) as ApiError;
  error.code = code;
  error.statusCode = statusCode || 400;
  error.details = details;
  return error;
};
