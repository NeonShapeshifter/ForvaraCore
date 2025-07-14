import { Router } from 'express';
import { success } from '@/utils/responses';
import { supabase,} from '@/config/database';
import testDatabaseConnection from '@/config/database';

const router = Router();

// Basic health check - always returns 200 for Railway
router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  // Basic health info
  const healthInfo = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    responseTime: 0
  };

  // Check if we want detailed health check
  const detailed = req.query.detailed === 'true';
  
  if (detailed) {
    // Test database connection (non-blocking)
    try {
      const dbConnected = await testDatabaseConnection();
      healthInfo['database'] = dbConnected ? 'connected' : 'disconnected';
    } catch (err) {
      healthInfo['database'] = 'error';
      console.error('Database health check error:', err);
    }
  }

  // Calculate response time
  healthInfo.responseTime = Date.now() - startTime;

  // Always return 200 OK for basic health check
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
