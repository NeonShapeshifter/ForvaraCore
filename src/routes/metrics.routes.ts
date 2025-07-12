import { Router } from 'express';
import * as metricsController from '../controllers/metrics.controller';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/authorization';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { validateQuery } from '../middleware/validation';
import { UserRole } from '../constants/roles';
import { z } from 'zod';
import { commonValidators } from '../middleware/validation';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/metrics/overview:
 *   get:
 *     summary: Obtener métricas generales
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, yesterday, 7d, 30d, 90d, 1y]
 *           default: 30d
 *       - in: query
 *         name: compare
 *         schema:
 *           type: boolean
 *           default: true
 *           description: Comparar con período anterior
 *     responses:
 *       200:
 *         description: Métricas generales del tenant
 */
router.get('/overview',
  requireTenant,
  validateQuery(z.object({
    period: z.enum(['today', 'yesterday', '7d', '30d', '90d', '1y']).optional().default('30d'),
    compare: z.boolean().optional().default(true)
  })),
  metricsController.getOverviewMetrics
);

/**
 * @swagger
 * /api/metrics/usage:
 *   get:
 *     summary: Métricas de uso por recurso
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: resource
 *         schema:
 *           type: string
 *           enum: [storage, api_calls, users, mail_messages, files]
 *       - in: query
 *         name: granularity
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *           default: day
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Métricas de uso detalladas
 */
router.get('/usage',
  requireTenant,
  validateQuery(z.object({
    resource: z.enum(['storage', 'api_calls', 'users', 'mail_messages', 'files']).optional(),
    granularity: z.enum(['hour', 'day', 'week', 'month']).optional().default('day'),
    from: z.string().optional(),
    to: z.string().optional()
  })),
  metricsController.getUsageMetrics
);

/**
 * @swagger
 * /api/metrics/performance:
 *   get:
 *     summary: Métricas de rendimiento
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [response_time, error_rate, uptime, throughput]
 *       - in: query
 *         name: service
 *         schema:
 *           type: string
 *           enum: [api, database, storage, mail]
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [1h, 6h, 24h, 7d]
 *           default: 24h
 *     responses:
 *       200:
 *         description: Métricas de rendimiento
 */
router.get('/performance',
  requireTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateQuery(z.object({
    metric: z.enum(['response_time', 'error_rate', 'uptime', 'throughput']).optional(),
    service: z.enum(['api', 'database', 'storage', 'mail']).optional(),
    period: z.enum(['1h', '6h', '24h', '7d']).optional().default('24h')
  })),
  metricsController.getPerformanceMetrics
);

/**
 * @swagger
 * /api/metrics/costs:
 *   get:
 *     summary: Análisis de costos
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: breakdown
 *         schema:
 *           type: string
 *           enum: [app, resource, user]
 *           default: app
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [current_month, last_month, 3m, 6m, 1y]
 *           default: current_month
 *     responses:
 *       200:
 *         description: Análisis detallado de costos
 */
router.get('/costs',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateQuery(z.object({
    breakdown: z.enum(['app', 'resource', 'user']).optional().default('app'),
    period: z.enum(['current_month', 'last_month', '3m', '6m', '1y']).optional().default('current_month')
  })),
  metricsController.getCostAnalysis
);

/**
 * @swagger
 * /api/metrics/trends:
 *   get:
 *     summary: Tendencias y predicciones
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [users, storage, revenue, usage]
 *       - in: query
 *         name: forecast_days
 *         schema:
 *           type: integer
 *           minimum: 7
 *           maximum: 90
 *           default: 30
 *     responses:
 *       200:
 *         description: Análisis de tendencias con predicciones
 */
router.get('/trends',
  requireTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateQuery(z.object({
    metric: z.enum(['users', 'storage', 'revenue', 'usage']),
    forecast_days: z.coerce.number().min(7).max(90).optional().default(30)
  })),
  metricsController.getTrends
);

/**
 * @swagger
 * /api/metrics/alerts:
 *   get:
 *     summary: Alertas de métricas
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, resolved, acknowledged]
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [info, warning, critical]
 *     responses:
 *       200:
 *         description: Lista de alertas activas
 */
router.get('/alerts',
  requireTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateQuery(z.object({
    status: z.enum(['active', 'resolved', 'acknowledged']).optional(),
    severity: z.enum(['info', 'warning', 'critical']).optional()
  })),
  metricsController.getMetricAlerts
);

/**
 * @swagger
 * /api/metrics/export:
 *   post:
 *     summary: Exportar reporte de métricas
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, period]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [executive_summary, detailed_usage, cost_analysis, performance_report]
 *               period:
 *                 type: object
 *                 properties:
 *                   from:
 *                     type: string
 *                     format: date
 *                   to:
 *                     type: string
 *                     format: date
 *               format:
 *                 type: string
 *                 enum: [pdf, excel, csv]
 *                 default: pdf
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email para enviar el reporte
 *     responses:
 *       200:
 *         description: Reporte generado
 */
router.post('/export',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  metricsController.exportReport
);

/**
 * @swagger
 * /api/metrics/custom:
 *   post:
 *     summary: Consulta personalizada de métricas
 *     tags: [Metrics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query]
 *             properties:
 *               query:
 *                 type: object
 *                 properties:
 *                   metrics:
 *                     type: array
 *                     items:
 *                       type: string
 *                   filters:
 *                     type: object
 *                   groupBy:
 *                     type: array
 *                     items:
 *                       type: string
 *                   orderBy:
 *                     type: string
 *                   limit:
 *                     type: integer
 *     responses:
 *       200:
 *         description: Resultados de la consulta
 */
router.post('/custom',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  metricsController.customQuery
);

export default router;
