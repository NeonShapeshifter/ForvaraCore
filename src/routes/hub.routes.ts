import { Router } from 'express';
import * as hubController from '../controllers/hub.controller';
import { authenticateToken } from '../middleware/auth';
import { injectTenant } from '../middleware/tenant';
import { validateQuery } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/hub/dashboard:
 *   get:
 *     summary: Obtener datos del dashboard principal
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Datos del dashboard
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 tenants:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Tenant'
 *                 apps:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       icon:
 *                         type: string
 *                       hasAccess:
 *                         type: boolean
 *                       subscriptionStatus:
 *                         type: string
 *                 notifications:
 *                   type: object
 *                   properties:
 *                     unreadCount:
 *                       type: integer
 *                     recent:
 *                       type: array
 *                 quickStats:
 *                   type: object
 */
router.get('/dashboard',
  hubController.getDashboard
);

/**
 * @swagger
 * /api/hub/apps:
 *   get:
 *     summary: Obtener aplicaciones disponibles
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, subscribed, available]
 *           default: all
 *     responses:
 *       200:
 *         description: Lista de aplicaciones
 */
router.get('/apps',
  validateQuery(z.object({
    category: z.enum(['all', 'subscribed', 'available']).optional().default('all')
  })),
  hubController.getApps
);

/**
 * @swagger
 * /api/hub/quick-actions:
 *   get:
 *     summary: Obtener acciones rápidas personalizadas
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Lista de acciones rápidas
 */
router.get('/quick-actions',
  injectTenant,
  hubController.getQuickActions
);

/**
 * @swagger
 * /api/hub/recent-activity:
 *   get:
 *     summary: Actividad reciente del usuario
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Actividad reciente
 */
router.get('/recent-activity',
  validateQuery(z.object({
    limit: z.coerce.number().min(1).max(50).optional().default(10)
  })),
  hubController.getRecentActivity
);

/**
 * @swagger
 * /api/hub/announcements:
 *   get:
 *     summary: Obtener anuncios del sistema
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Anuncios activos
 */
router.get('/announcements',
  hubController.getAnnouncements
);

/**
 * @swagger
 * /api/hub/search:
 *   get:
 *     summary: Búsqueda global
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 2
 *       - in: query
 *         name: type
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [users, files, messages, invoices, products]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 */
router.get('/search',
  validateQuery(z.object({
    q: z.string().min(2),
    type: z.array(z.enum(['users', 'files', 'messages', 'invoices', 'products'])).optional(),
    limit: z.coerce.number().min(1).max(100).optional().default(20)
  })),
  hubController.globalSearch
);

/**
 * @swagger
 * /api/hub/onboarding-status:
 *   get:
 *     summary: Estado del onboarding
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Estado del onboarding
 */
router.get('/onboarding-status',
  injectTenant,
  hubController.getOnboardingStatus
);

/**
 * @swagger
 * /api/hub/onboarding/complete-step:
 *   post:
 *     summary: Completar paso de onboarding
 *     tags: [Hub]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [step]
 *             properties:
 *               step:
 *                 type: string
 *                 enum: [profile_complete, team_invited, first_app, first_invoice]
 *     responses:
 *       200:
 *         description: Paso completado
 */
router.post('/onboarding/complete-step',
  hubController.completeOnboardingStep
);

export default router;
