import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { corsOptions } from './config/cors';
import { setupSwagger } from './config/swagger';
import { errorHandler } from './middleware/errorHandler';
import { performanceMiddleware } from './middleware/performance';
import { requestIdMiddleware } from './middleware/requestId';
import routes from './routes';
import { logger } from './config/logger';

const app: Application = express();

// Trust proxy (para obtener IP real detrás de proxies)
app.set('trust proxy', true);

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https:", "wss:"],
    },
  },
}));

// CORS
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Para webhooks que necesitan raw body
    if (req.url?.startsWith('/webhooks/')) {
      (req as any).rawBody = buf.toString();
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// Request ID
app.use(requestIdMiddleware);

// Logging
app.use(morgan('combined', {
  stream: { 
    write: (message) => logger.info(message.trim(), { source: 'morgan' })
  },
  skip: (req) => req.url === '/health' || req.url === '/metrics'
}));

// Performance monitoring
app.use(performanceMiddleware);

// API routes
app.use('/api', routes);

// Swagger documentation
if (process.env.NODE_ENV !== 'production') {
  try {
    setupSwagger(app);
  } catch (error) {
    logger.warn('Swagger setup failed, continuing without documentation', { error });
  }
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `The route ${req.method} ${req.originalUrl} does not exist`,
    code: 'ROUTE_NOT_FOUND'
  });
});

// Global error handler (debe ir al final)
app.use(errorHandler);

export default app;
