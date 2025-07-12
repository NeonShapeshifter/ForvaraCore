/**
 * Límites del sistema
 */
export const SYSTEM_LIMITS = {
  // Usuarios
  MAX_USERS_PER_TENANT: 1000,
  MAX_TENANTS_PER_USER: 10,
  MAX_SESSIONS_PER_USER: 5,
  
  // Archivos
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  MAX_FILES_PER_UPLOAD: 10,
  MAX_STORAGE_PER_TENANT: 100 * 1024 * 1024 * 1024, // 100GB
  ALLOWED_FILE_EXTENSIONS: [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.json', '.xml',
    '.zip', '.rar', '.7z'
  ],
  
  // Mensajes
  MAX_MESSAGE_LENGTH: 5000,
  MAX_ATTACHMENTS_PER_MESSAGE: 10,
  MAX_CHANNELS_PER_USER: 100,
  MAX_MEMBERS_PER_CHANNEL: 500,
  
  // API
  RATE_LIMIT_WINDOW: 15 * 60 * 1000, // 15 minutos
  RATE_LIMIT_MAX_REQUESTS: 100,
  API_KEY_LENGTH: 32,
  MAX_API_KEYS_PER_TENANT: 10,
  
  // Notificaciones
  MAX_NOTIFICATIONS_PER_USER: 1000,
  NOTIFICATION_RETENTION_DAYS: 90,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER: 5,
  
  // Suscripciones
  TRIAL_DAYS: 14,
  GRACE_PERIOD_DAYS: 7,
  MAX_PAYMENT_METHODS: 5,
  
  // Passwords
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  PASSWORD_HISTORY_COUNT: 5,
  PASSWORD_EXPIRY_DAYS: 90,
  
  // Tokens
  ACCESS_TOKEN_EXPIRY: '7d',
  REFRESH_TOKEN_EXPIRY: '30d',
  TEMP_TOKEN_EXPIRY: '15m',
  EMAIL_TOKEN_EXPIRY: '24h',
  
  // Cache
  DEFAULT_CACHE_TTL: 3600, // 1 hora
  MAX_CACHE_SIZE: 100 * 1024 * 1024, // 100MB
  
  // Búsqueda
  MAX_SEARCH_RESULTS: 100,
  MIN_SEARCH_LENGTH: 2,
  SEARCH_DEBOUNCE_MS: 300,
  
  // Paginación
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  
  // Logs
  ACTIVITY_LOG_RETENTION_DAYS: 365,
  ERROR_LOG_RETENTION_DAYS: 30,
  MAX_LOG_SIZE: 10 * 1024 * 1024, // 10MB
  
  // Otros
  MAX_TAGS_PER_RESOURCE: 10,
  MAX_METADATA_SIZE: 1024 * 10, // 10KB
  MAX_DESCRIPTION_LENGTH: 1000,
  MAX_NAME_LENGTH: 255
};

/**
 * Límites por plan de suscripción
 */
export const PLAN_LIMITS = {
  free: {
    users: 3,
    storage: 1 * 1024 * 1024 * 1024, // 1GB
    api_calls_per_month: 1000,
    file_size: 10 * 1024 * 1024, // 10MB
    features: ['basic']
  },
  
  starter: {
    users: 10,
    storage: 10 * 1024 * 1024 * 1024, // 10GB
    api_calls_per_month: 10000,
    file_size: 25 * 1024 * 1024, // 25MB
    features: ['basic', 'api', 'webhooks']
  },
  
  professional: {
    users: 50,
    storage: 50 * 1024 * 1024 * 1024, // 50GB
    api_calls_per_month: 100000,
    file_size: 50 * 1024 * 1024, // 50MB
    features: ['basic', 'api', 'webhooks', 'analytics', 'priority_support']
  },
  
  enterprise: {
    users: -1, // Ilimitado
    storage: -1, // Ilimitado
    api_calls_per_month: -1, // Ilimitado
    file_size: 100 * 1024 * 1024, // 100MB
    features: ['all']
  }
};

/**
 * Timeouts
 */
export const TIMEOUTS = {
  API_REQUEST: 30000, // 30 segundos
  DATABASE_QUERY: 10000, // 10 segundos
  FILE_UPLOAD: 300000, // 5 minutos
  WEBHOOK_DELIVERY: 5000, // 5 segundos
  EMAIL_SEND: 10000, // 10 segundos
  CACHE_OPERATION: 1000, // 1 segundo
  LOCK_ACQUISITION: 5000 // 5 segundos
};

/**
 * Verificar si un valor excede el límite
 */
export function exceedsLimit(value: number, limit: number): boolean {
  return limit !== -1 && value > limit;
}

/**
 * Obtener límite para un tenant basado en su plan
 */
export function getTenantLimit(plan: string, limitType: keyof typeof PLAN_LIMITS.free): number {
  const planLimits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS];
  return planLimits ? planLimits[limitType] as number : PLAN_LIMITS.free[limitType] as number;
}
