import { ApiResponse, PaginatedResponse } from '../types';

/**
 * Crear respuesta API estandarizada
 */
export function createApiResponse<T = any>(
  success: boolean,
  data: T | null = null,
  message?: string,
  error?: string,
  code?: string,
  meta?: Record<string, any>
): ApiResponse<T> {
  const response: ApiResponse<T> = {
    success,
    data: data || undefined,
    message,
    error,
    code,
    meta: {
      ...meta,
      timestamp: new Date().toISOString()
    }
  };

  // Limpiar propiedades undefined
  Object.keys(response).forEach(key => {
    if (response[key as keyof ApiResponse<T>] === undefined) {
      delete response[key as keyof ApiResponse<T>];
    }
  });

  return response;
}

/**
 * Crear respuesta paginada
 */
export function createPaginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  meta?: Record<string, any>
): ApiResponse<PaginatedResponse<T>> {
  return createApiResponse(
    true,
    {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      }
    },
    undefined,
    undefined,
    undefined,
    meta
  );
}

/**
 * Crear respuesta de error
 */
export function createErrorResponse(
  error: string,
  code: string = 'INTERNAL_ERROR',
  statusCode: number = 500,
  details?: any
): ApiResponse<null> {
  return createApiResponse(
    false,
    null,
    undefined,
    error,
    code,
    {
      statusCode,
      details
    }
  );
}

/**
 * Crear respuesta exitosa
 */
export function createSuccessResponse<T = any>(
  data: T,
  message?: string,
  meta?: Record<string, any>
): ApiResponse<T> {
  return createApiResponse(true, data, message, undefined, undefined, meta);
}

/**
 * Formatear errores de validación
 */
export function formatValidationErrors(errors: any[]): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  errors.forEach(error => {
    const field = error.path?.join('.') || 'general';
    if (!formatted[field]) {
      formatted[field] = [];
    }
    formatted[field].push(error.message);
  });

  return formatted;
}
