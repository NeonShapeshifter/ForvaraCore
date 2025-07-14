import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { supabase } from '@/config/database';

const router = Router();

router.get('/', async (req, res) => {
  try {
    // Test database connection
    const { data, error: dbError } = await supabase
      .from('users')
      .select('count')
      .limit(1);

    if (dbError) {
      console.error('❌ Database health check failed:', dbError);
      return res.status(503).json({
        status: 'unhealthy',
        error: 'Database connection failed',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        environment: process.env.NODE_ENV || 'development'
      });
    }

    return success(res, {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: 'connected',
      uptime: process.uptime()
    });
  } catch (err: any) {
    console.error('❌ Health check error:', err);
    return res.status(503).json({
      status: 'unhealthy',
      error: err.message || 'Health check failed',
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      environment: process.env.NODE_ENV || 'development'
    });
  }
});

export { router as healthRoutes };