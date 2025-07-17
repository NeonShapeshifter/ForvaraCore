import { Router } from 'express';
import { success } from '../utils/responses.js';
import { supabase, testDatabaseConnection } from '../config/database.js';

const router = Router();

// Railway-optimized health check - ALWAYS returns 200
router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  // Log health check for Railway debugging
  console.log(`🩺 Health check requested at ${new Date().toISOString()}`);
  console.log(`📡 From IP: ${req.ip || req.connection.remoteAddress || 'unknown'}`);
  console.log(`🔍 User-Agent: ${req.get('User-Agent') || 'none'}`);
  console.log(`🌐 Headers:`, JSON.stringify(req.headers, null, 2));
  
  // Railway-specific health info
  const healthInfo = {
    status: 'healthy',
    service: 'ForvaraCore',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    railway: {
      environment: process.env.RAILWAY_ENVIRONMENT || 'unknown',
      project: process.env.RAILWAY_PROJECT_NAME || 'unknown',
      service: process.env.RAILWAY_SERVICE_NAME || 'unknown'
    },
    port: process.env.PORT || '4000',
    responseTime: 0
  };

  // Check if we want detailed health check
  const detailed = req.query.detailed === 'true';
  
  if (detailed) {
    console.log('🔍 Performing detailed health check...');
    try {
      const dbConnected = await testDatabaseConnection();
      healthInfo['database'] = dbConnected ? 'connected' : 'disconnected';
      console.log(`💾 Database status: ${healthInfo['database']}`);
    } catch (err) {
      healthInfo['database'] = 'error';
      console.error('❌ Database health check error:', err);
    }
  }

  // Calculate response time
  healthInfo.responseTime = Date.now() - startTime;
  
  console.log(`✅ Health check completed in ${healthInfo.responseTime}ms`);

  // Set headers for Railway
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Service': 'ForvaraCore',
    'X-Version': '3.0.0'
  });

  // Always return 200 OK with success wrapper
  return success(res, healthInfo);
});

// Separate endpoint for deep health check
router.get('/deep', async (req, res) => {
  try {
    // Test database connection with timeout
    const dbPromise = supabase
      .from('users')
      .select('count')
      .limit(1);

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database timeout')), 5000)
    );

    const { data, error: dbError } = await Promise.race([dbPromise, timeoutPromise]) as any;

    if (dbError) {
      console.error('❌ Deep health check - Database failed:', dbError);
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Database connection failed',
        details: dbError.message,
        timestamp: new Date().toISOString()
      });
    }

    return success(res, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: 'connected',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (err: any) {
    console.error('❌ Deep health check error:', err);
    return res.status(503).json({
      status: 'unhealthy',
      error: err.message || 'Deep health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

export { router as healthRoutes };
