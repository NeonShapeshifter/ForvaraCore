import { Router } from 'express';
import * as activityController from '../controllers/activity.controller';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/authorization';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { validateQuery } from '../middleware/validation';
import { commonValidators } from '../middleware/validation';
import { UserRole } from '../constants/roles';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/activity:
 *   get:
 *     summary: Obtener logs de actividad
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *       - in: query
 *         name: resourceId
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 * *         name: success
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created_at, action, user_id]
 *           default: created_at
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *     responses:
 *       200:
 *         description: Lista de actividades
 */
router.get('/',
  requireTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateQuery(z.object({
    ...commonValidators.pagination.shape,
    userId: commonValidators.uuid.optional(),
    action: z.string().optional(),
    resourceType: z.string().optional(),
    resourceId: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    success: z.boolean().optional(),
    sortBy: z.enum(['created_at', 'action', 'user_id']).optional().default('created_at'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc')
  })),
  activityController.getActivityLogs
);

/**
 * @swagger
 * /api/activity/export:
 *   post:
 *     summary: Exportar logs de actividad
 *     tags: [Activity]
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
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [csv, json, pdf]
 *                 default: csv
 *               filters:
 *                 type: object
 *                 properties:
 *                   userId:
 *                     type: string
 *                     format: uuid
 *                   action:
 *                     type: string
 *                   from:
 *                     type: string
 *                     format: date-time
 *                   to:
 *                     type: string
 *                     format: date-time
 *               includeDetails:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Archivo exportado
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 */
router.post('/export',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  activityController.exportActivityLogs
);

/**
 * @swagger
 * /api/activity/stats:
 *   get:
 *     summary: Obtener estadísticas de actividad
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 90d]
 *           default: 7d
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *           default: day
 *     responses:
 *       200:
 *         description: Estadísticas de actividad
 */
router.get('/stats',
  requireTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateQuery(z.object({
    period: z.enum(['24h', '7d', '30d', '90d']).optional().default('7d'),
    groupBy: z.enum(['hour', 'day', 'week', 'month']).optional().default('day')
  })),
  activityController.getActivityStats
);

/**
 * @swagger
 * /api/activity/my-activity:
 *   get:
 *     summary: Obtener mi actividad reciente
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Mi actividad reciente
 */
router.get('/my-activity',
  validateQuery(commonValidators.pagination),
  activityController.getMyActivity
);

/**
 * @swagger
 * /api/activity/suspicious:
 *   get:
 *     summary: Obtener actividades sospechosas
 *     tags: [Activity]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [low, medium, high, critical]
 *     responses:
 *       200:
 *         description: Actividades sospechosas detectadas
 */
router.get('/suspicious',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateQuery(z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional()
  })),
  activityController.getSuspiciousActivity
);

export default router;
