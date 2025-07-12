import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { tenantRoutes } from './routes/tenants';
import { appRoutes } from './routes/apps';
import { userRoutes } from './routes/users';
import { hubRoutes } from './routes/hub';

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
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

// Root health check
app.get('/', (req, res) => {
  res.json({
    data: {
      status: 'healthy',
      service: 'ForvaraCore',
      version: '3.0.0',
      timestamp: new Date().toISOString()
    }
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
