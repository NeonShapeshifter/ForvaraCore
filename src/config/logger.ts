import pino from 'pino';
import { config } from './index';

const isProduction = config.NODE_ENV === 'production';
const isTest = config.NODE_ENV === 'test';

// Configuración base del logger
const baseConfig = {
  level: isTest ? 'silent' : config.LOG_LEVEL,
  formatters: {
    level: (label: string) => ({ level: label }),
    log: (object: any) => ({
      ...object,
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      service: 'forvara-core',
      version: '2.0.0'
    })
  },
  serializers: {
    req: (req: any) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      query: req.query,
      params: req.params,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for']
      }
    }),
    res: (res: any) => ({
      statusCode: res.statusCode,
      duration: res.responseTime
    }),
    error: pino.stdSerializers.err
  },
  redact: {
    paths: [
      'password',
      'token',
      'authorization',
      'api_key',
      'stripe_secret_key',
      'jwt_secret',
      '*.password',
      '*.token',
      'headers.authorization',
      'headers["x-api-key"]'
    ],
    censor: '[REDACTED]'
  }
};

// Configuración para desarrollo
const devConfig = {
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,service,version',
      messageFormat: '{msg}',
      errorLikeObjectKeys: ['err', 'error']
    }
  }
};

// Crear logger
export const logger = pino({
  ...baseConfig,
  ...(isProduction ? {} : devConfig)
});

// Logger específicos por módulo
export const createLogger = (module: string) => logger.child({ module });

// Helper para log de performance
export const logPerformance = (
  operation: string,
  duration: number,
  metadata?: Record<string, any>
) => {
  const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
  
  logger[level]({
    operation,
    duration,
    performance: {
      seconds: (duration / 1000).toFixed(3),
      category: duration > 5000 ? 'slow' : duration > 1000 ? 'normal' : 'fast'
    },
    ...metadata
  }, `Operation ${operation} took ${duration}ms`);
};

// Helper para log de errores con contexto
export const logError = (
  error: Error | unknown, context: Record<string, any>) => {
logger.error({
error: error instanceof Error ? {
message: error.message,
stack: error.stack,
name: error.name
} : error,
...context
}, 'Error occurred');
};
