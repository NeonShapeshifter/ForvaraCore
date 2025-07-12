/**
 * Códigos de error estandarizados
 */
export enum ErrorCode {
  // Autenticación y Autorización
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED',
  TWO_FACTOR_INVALID = 'TWO_FACTOR_INVALID',
  
  // Validación
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_FIELD = 'MISSING_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  
  // Recursos
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  RESOURCE_LOCKED = 'RESOURCE_LOCKED',
  RESOURCE_EXPIRED = 'RESOURCE_EXPIRED',
  
  // Límites
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  STORAGE_LIMIT_EXCEEDED = 'STORAGE_LIMIT_EXCEEDED',
  USER_LIMIT_EXCEEDED = 'USER_LIMIT_EXCEEDED',
  
  // Pagos
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  SUBSCRIPTION_CANCELLED = 'SUBSCRIPTION_CANCELLED',
  INVALID_PAYMENT_METHOD = 'INVALID_PAYMENT_METHOD',
  
  // Sistema
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  
  // Archivos
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_UPLOAD_FAILED = 'FILE_UPLOAD_FAILED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  
  // Permisos
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  TENANT_ACCESS_DENIED = 'TENANT_ACCESS_DENIED',
  FEATURE_NOT_AVAILABLE = 'FEATURE_NOT_AVAILABLE',
  
  // Otros
  INVALID_OPERATION = 'INVALID_OPERATION',
  CONFLICT = 'CONFLICT',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY'
}

/**
 * Mensajes de error por defecto
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  [ErrorCode.UNAUTHORIZED]: 'No autorizado',
  [ErrorCode.FORBIDDEN]: 'Acceso denegado',
  [ErrorCode.INVALID_CREDENTIALS]: 'Credenciales inválidas',
  [ErrorCode.TOKEN_EXPIRED]: 'Token expirado',
  [ErrorCode.TOKEN_INVALID]: 'Token inválido',
  [ErrorCode.SESSION_EXPIRED]: 'Sesión expirada',
  [ErrorCode.TWO_FACTOR_REQUIRED]: 'Se requiere autenticación de dos factores',
  [ErrorCode.TWO_FACTOR_INVALID]: 'Código de dos factores inválido',
  
  [ErrorCode.VALIDATION_ERROR]: 'Error de validación',
  [ErrorCode.INVALID_INPUT]: 'Entrada inválida',
  [ErrorCode.MISSING_FIELD]: 'Campo requerido faltante',
  [ErrorCode.INVALID_FORMAT]: 'Formato inválido',
  
  [ErrorCode.NOT_FOUND]: 'Recurso no encontrado',
  [ErrorCode.ALREADY_EXISTS]: 'El recurso ya existe',
  [ErrorCode.RESOURCE_LOCKED]: 'Recurso bloqueado',
  [ErrorCode.RESOURCE_EXPIRED]: 'Recurso expirado',
  
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Límite de solicitudes excedido',
  [ErrorCode.QUOTA_EXCEEDED]: 'Cuota excedida',
  [ErrorCode.STORAGE_LIMIT_EXCEEDED]: 'Límite de almacenamiento excedido',
  [ErrorCode.USER_LIMIT_EXCEEDED]: 'Límite de usuarios excedido',
  
  [ErrorCode.PAYMENT_REQUIRED]: 'Pago requerido',
  [ErrorCode.PAYMENT_FAILED]: 'Pago fallido',
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 'Suscripción expirada',
  [ErrorCode.SUBSCRIPTION_CANCELLED]: 'Suscripción cancelada',
  [ErrorCode.INVALID_PAYMENT_METHOD]: 'Método de pago inválido',
  
  [ErrorCode.INTERNAL_ERROR]: 'Error interno del servidor',
  [ErrorCode.SERVICE_UNAVAILABLE]: 'Servicio no disponible',
  [ErrorCode.DATABASE_ERROR]: 'Error de base de datos',
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 'Error en servicio externo',
  
  [ErrorCode.FILE_TOO_LARGE]: 'Archivo demasiado grande',
  [ErrorCode.INVALID_FILE_TYPE]: 'Tipo de archivo no permitido',
  [ErrorCode.FILE_UPLOAD_FAILED]: 'Error al subir archivo',
  [ErrorCode.FILE_NOT_FOUND]: 'Archivo no encontrado',
  
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 'Permisos insuficientes',
  [ErrorCode.TENANT_ACCESS_DENIED]: 'Acceso denegado a la empresa',
  [ErrorCode.FEATURE_NOT_AVAILABLE]: 'Función no disponible en tu plan',
  
  [ErrorCode.INVALID_OPERATION]: 'Operación inválida',
  [ErrorCode.CONFLICT]: 'Conflicto con el estado actual',
  [ErrorCode.PRECONDITION_FAILED]: 'Precondición fallida',
  [ErrorCode.UNPROCESSABLE_ENTITY]: 'Entidad no procesable'
};

/**
 * Códigos HTTP por tipo de error
 */
export const ErrorStatusCodes: Record<ErrorCode, number> = {
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.INVALID_CREDENTIALS]: 401,
  [ErrorCode.TOKEN_EXPIRED]: 401,
  [ErrorCode.TOKEN_INVALID]: 401,
  [ErrorCode.SESSION_EXPIRED]: 401,
  [ErrorCode.TWO_FACTOR_REQUIRED]: 401,
  [ErrorCode.TWO_FACTOR_INVALID]: 401,
  
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.INVALID_INPUT]: 400,
  [ErrorCode.MISSING_FIELD]: 400,
  [ErrorCode.INVALID_FORMAT]: 400,
  
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.ALREADY_EXISTS]: 409,
  [ErrorCode.RESOURCE_LOCKED]: 423,
  [ErrorCode.RESOURCE_EXPIRED]: 410,
  
  [ErrorCode.RATE_LIMIT_EXCEEDED]: 429,
  [ErrorCode.QUOTA_EXCEEDED]: 429,
  [ErrorCode.STORAGE_LIMIT_EXCEEDED]: 413,
  [ErrorCode.USER_LIMIT_EXCEEDED]: 429,
  
  [ErrorCode.PAYMENT_REQUIRED]: 402,
  [ErrorCode.PAYMENT_FAILED]: 402,
  [ErrorCode.SUBSCRIPTION_EXPIRED]: 402,
  [ErrorCode.SUBSCRIPTION_CANCELLED]: 402,
  [ErrorCode.INVALID_PAYMENT_METHOD]: 402,
  
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
  [ErrorCode.DATABASE_ERROR]: 500,
  [ErrorCode.EXTERNAL_SERVICE_ERROR]: 502,
  
  [ErrorCode.FILE_TOO_LARGE]: 413,
  [ErrorCode.INVALID_FILE_TYPE]: 415,
  [ErrorCode.FILE_UPLOAD_FAILED]: 500,
  [ErrorCode.FILE_NOT_FOUND]: 404,
  
  [ErrorCode.INSUFFICIENT_PERMISSIONS]: 403,
  [ErrorCode.TENANT_ACCESS_DENIED]: 403,
  [ErrorCode.FEATURE_NOT_AVAILABLE]: 403,
  
  [ErrorCode.INVALID_OPERATION]: 400,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.PRECONDITION_FAILED]: 412,
  [ErrorCode.UNPROCESSABLE_ENTITY]: 422
};

/**
 * Helper function to get error message
 */
export const getErrorMessage = (code: ErrorCode): string => {
  return ErrorMessages[code] || 'Unknown error';
};
