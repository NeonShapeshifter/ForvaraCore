import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { tenantRoutes } from './routes/tenants.js';
import { appRoutes } from './routes/apps.js';
import { userRoutes } from './routes/users.js';
import { hubRoutes } from './routes/hub.js';
import { billingRoutes } from './routes/billing.js';
import { analyticsRoutes } from './routes/analytics.js';
import { adminRoutes } from './routes/admin.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { securityRoutes } from './routes/security.js';
import { generalRateLimit } from './utils/security.js';

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// HTTPS enforcement in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Rate limiting (apply to all requests)
app.use(generalRateLimit);

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:5174'];
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Compression
app.use(compression());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/hub', hubRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/password-reset', passwordResetRoutes);
app.use('/api/security', securityRoutes);

// Root health check
app.get('/', (req, res) => {
  res.json({
    data: {
      status: 'healthy',
      service: 'ForvaraCore',
      version: '3.0.0',
      timestamp: new Date().toISOString(),
      health_endpoint: '/api/health'
    }
  });
});

// Additional health check at root /health for extra compatibility
app.get('/health', (req, res) => {
  console.log('🩺 Root health check requested');
  res.status(200).json({
    status: 'ok',
    service: 'ForvaraCore',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime())
  });
});

// Simple ping endpoint for Railway
app.get('/ping', (req, res) => {
  console.log('🏓 Ping requested');
  res.status(200).send('pong');
});

// Railway-specific healthcheck (alternative path)
app.get('/healthz', (req, res) => {
  console.log('🔍 Healthz endpoint requested (Kubernetes style)');
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      message: 'Route not found',
      code: 'NOT_FOUND'
    }
  });
});

// Global error handler (Railway-safe)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌ Global error handler:', err);
  
  // Si ya se envió response, no hacer nada (evita crashes)
  if (res.headersSent) {
    return;
  }
  
  // Error response seguro
  res.status(err.status || 500).json({
    error: {
      message: process.env.NODE_ENV === 'production' 
        ? 'Something went wrong' 
        : (err.message || 'Internal server error'),
      code: err.code || 'SERVER_ERROR'
    }
  });
});

export default app;
