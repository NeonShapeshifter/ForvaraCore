declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      PORT: string;
      
      // Database
      SUPABASE_URL: string;
      SUPABASE_SERVICE_KEY: string;
      SUPABASE_ANON_KEY?: string;
      
      // Auth
      JWT_SECRET: string;
      JWT_EXPIRY?: string;
      BCRYPT_ROUNDS?: string;
      
      // Storage
      STORAGE_BUCKET?: string;
      MAX_FILE_SIZE?: string;
      ALLOWED_FILE_TYPES?: string;
      
      // Redis
      REDIS_URL?: string;
      REDIS_TTL?: string;
      
      // Frontend
      FRONTEND_URLS?: string;
      
      // Email
      SMTP_HOST?: string;
      SMTP_PORT?: string;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      EMAIL_FROM?: string;
      
      // Stripe
      STRIPE_SECRET_KEY?: string;
      STRIPE_WEBHOOK_SECRET?: string;
      
      // Features
      ENABLE_WEBSOCKETS?: string;
      ENABLE_QUEUE_DASHBOARD?: string;
      
      // Monitoring
      SENTRY_DSN?: string;
      LOG_LEVEL?: string;
      
      // Rate limiting
      RATE_LIMIT_WINDOW_MS?: string;
      RATE_LIMIT_MAX_REQUESTS?: string;
    }
  }
}

export {};
