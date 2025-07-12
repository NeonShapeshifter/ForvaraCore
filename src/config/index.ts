// dotenv/config se carga en server.ts, no aquí
// import dotenv from 'dotenv';
// import path from 'path';

export interface Config {
  // Server
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  
  // Database
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_ANON_KEY: string;
  
  // Auth
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  BCRYPT_ROUNDS: number;
  ENCRYPTION_KEY: string;
  
  // Storage
  STORAGE_BUCKET: string;
  MAX_FILE_SIZE: number;
  ALLOWED_FILE_TYPES: string[];
  
  // Redis
  REDIS_URL: string;
  REDIS_TTL: number;
  
  // Frontend
  FRONTEND_URLS: string[];
  
  // Email
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
  EMAIL_FROM: string;
  
  // Stripe
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  
  // Features
  ENABLE_WEBSOCKETS: boolean;
  ENABLE_QUEUE_DASHBOARD: boolean;
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  
  // Monitoring
  SENTRY_DSN?: string;
  LOG_LEVEL: string;
}

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
};

const parseNumber = (value: string | undefined, defaultValue: number): number => {
  const parsed = parseInt(value || '', 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

export const config: Config = {
  // Server
  NODE_ENV: (process.env.NODE_ENV as any) || 'development',
  PORT: parseNumber(process.env.PORT, 4000),
  
  // Database
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  
  // Auth
  JWT_SECRET: process.env.JWT_SECRET!,
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  BCRYPT_ROUNDS: parseNumber(process.env.BCRYPT_ROUNDS, 10),
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET!,
  
  // Storage
  STORAGE_BUCKET: process.env.STORAGE_BUCKET || 'forvara-files',
  MAX_FILE_SIZE: parseNumber(process.env.MAX_FILE_SIZE, 52428800), // 50MB
  ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES?.split(',') || [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'application/json'
  ],
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  REDIS_TTL: parseNumber(process.env.REDIS_TTL, 3600), // 1 hora
  
  // Frontend
  FRONTEND_URLS: process.env.FRONTEND_URLS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  
  // Email
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: parseNumber(process.env.SMTP_PORT, 587),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'Forvara <noreply@forvara.com>',
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  
  // Features
  ENABLE_WEBSOCKETS: parseBoolean(process.env.ENABLE_WEBSOCKETS, true),
  ENABLE_QUEUE_DASHBOARD: parseBoolean(process.env.ENABLE_QUEUE_DASHBOARD, false),
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: parseNumber(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000), // 15 min
  RATE_LIMIT_MAX_REQUESTS: parseNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 100),
  
  // Monitoring
  SENTRY_DSN: process.env.SENTRY_DSN,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Validar configuración crítica
export const validateConfig = (): void => {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'JWT_SECRET'
  ];
  
  const missing = required.filter(key => !config[key as keyof Config]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validar JWT secret length
  if (config.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
};
