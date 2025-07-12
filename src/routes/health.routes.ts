import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/authorization';
import { UserRole } from '../constants/roles';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';

const router = Router();

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check básico
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Servicio saludable
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [healthy]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                 environment:
 *                   type: string
 */
router.get('/', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV,
    version: '2.0.0'
  });
});

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Servicio listo
 *       503:
 *         description: Servicio no listo
 */
router.get('/ready', async (req, res) => {
  try {
    // Verificar conexiones críticas
    const supabase = getSupabase();
    const redis = getRedis();
    
    await Promise.all([
      supabase.from('users').select('count').limit(1).single(),
      redis.ping()
    ]);
    
    res.json({ ready: true });
  } catch (error) {
    logger.error({ error }, 'Readiness check failed');
    res.status(503).json({ ready: false });
  }
});

/**
 * @swagger
 * /api/health/live:
 *   get:
 *     summary: Liveness check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Servicio vivo
 */
router.get('/live', (req, res) => {
  res.json({ alive: true });
});

/**
 * @swagger
 * /api/health/detailed:
 *   get:
 *     summary: Health check detallado
 *     tags: [Health]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Estado detallado del sistema
 */
router.get('/detailed',
  authenticateToken,
  requireRole([UserRole.ADMIN, UserRole.SUPER_ADMIN]),
  async (req, res) => {
    const checks = {
      database: { status: 'unknown', responseTime: 0 },
      redis: { status: 'unknown', responseTime: 0 },
      memory: { status: 'unknown', usage: {} },
      api: { status: 'healthy', responseTime: 0 }
    };

    // Check database
    try {
      const start = Date.now();
      const supabase = getSupabase();
      await supabase.from('users').select('count').limit(1).single();
      checks.database = {
        status: 'healthy',
        responseTime: Date.now() - start
      };
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        responseTime: -1,
        error: error.message
      };
    }

    // Check Redis
    try {
      const start = Date.now();
      const redis = getRedis();
      await redis.ping();
      const info = await redis.info('server');
      checks.redis = {
        status: 'healthy',
        responseTime: Date.now() - start,
        version: info.match(/redis_version:(.+)/)?.[1]
      };
    } catch (error) {
      checks.redis = {
        status: 'unhealthy',
        responseTime: -1,
        error: error.message
      };
    }

    // Check memory
    const memUsage = process.memoryUsage();
    const totalMem = require('os').totalmem();
    const freeMem = require('os').freemem();
    const usedMem = totalMem - freeMem;
    const memPercentage = (usedMem / totalMem) * 100;

    checks.memory = {
      status: memPercentage > 90 ? 'critical' : memPercentage > 75 ? 'warning' : 'healthy',
      usage: {
        system: {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          used: `${(usedMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)} GB`,
          percentage: `${memPercentage.toFixed(2)}%`
        },
        process: {
          rss: `${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          heapUsed: `${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          external: `${(memUsage.external / 1024 / 1024).toFixed(2)} MB`
        }
      }
    };

    // Overall status
    const allHealthy = Object.values(checks).every(
      check => check.status === 'healthy' || check.status === 'warning'
    );

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
      environment: {
        node: process.version,
        env: config.NODE_ENV,
        pid: process.pid
      }
    });
  }
);

export default router;
