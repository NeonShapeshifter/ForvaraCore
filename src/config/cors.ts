import { CorsOptions } from 'cors';
import { config } from './index';

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }

    // En desarrollo, permitir cualquier origen
    if (config.NODE_ENV === 'development') {
      return callback(null, true);
    }

    // Verificar contra lista de URLs permitidas
    if (config.FRONTEND_URLS.includes(origin)) {
      return callback(null, true);
    }

    // Permitir subdominios de forvara.com
    if (origin.endsWith('.forvara.com') || origin === 'https://forvara.com') {
      return callback(null, true);
    }

    // Bloquear otros orígenes
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Tenant-ID',
    'X-App-ID',
    'X-Request-ID',
    'X-API-Key'
  ],
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-Total-Count'
  ],
  maxAge: 86400 // 24 horas
};
