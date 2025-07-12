import { Router } from 'express';
import * as appsController from '../controllers/apps.controller';
import { authenticateToken } from '../middleware/auth';
import { validateParams, validateQuery, validateBody } from '../middleware/validation';
import { commonValidators } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/apps:
 *   get:
 *     summary: Listar todas las aplicaciones disponibles
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [system, business, communication, analytics, operations]
 *         description: Filtrar por categoría
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive, development]
 *         description: Filtrar por estado
 *       - in: query
 *         name: featured
 *         schema:
 *           type: boolean
 *         description: Solo apps destacadas
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Buscar por nombre o descripción
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Lista de aplicaciones
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/App'
 *                     pagination:
 *                       $ref: '#/components/schemas/Pagination'
 */
router.get('/', 
  validateQuery(z.object({
    category: z.string().optional(),
    status: z.enum(['active', 'inactive', 'development']).optional(),
    featured: z.boolean().optional(),
    search: z.string().optional(),
    page: z.number().optional().default(1),
    limit: z.number().optional().default(20)
  })),
  appsController.getAllApps
);

/**
 * @swagger
 * /api/apps/{appId}:
 *   get:
 *     summary: Obtener detalles de una aplicación
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID de la aplicación
 *     responses:
 *       200:
 *         description: Detalles de la aplicación
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/App'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get('/:appId',
  validateParams(commonValidators.uuid),
  appsController.getAppById
);

/**
 * @swagger
 * /api/apps/{appId}/plans:
 *   get:
 *     summary: Obtener planes de una aplicación
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Planes disponibles para la aplicación
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SubscriptionPlan'
 */
router.get('/:appId/plans',
  validateParams(commonValidators.uuid),
  appsController.getAppPlans
);

/**
 * @swagger
 * /api/apps/{appId}/addons:
 *   get:
 *     summary: Obtener complementos de una aplicación
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Complementos disponibles
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Addon'
 */
router.get('/:appId/addons',
  validateParams(commonValidators.uuid),
  appsController.getAppAddons
);

/**
 * @swagger
 * /api/apps/{appId}/install:
 *   post:
 *     summary: Instalar una aplicación en el tenant
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               planId:
 *                 type: string
 *                 format: uuid
 *                 description: ID del plan a suscribir (opcional)
 *               config:
 *                 type: object
 *                 description: Configuración inicial de la app
 *     responses:
 *       201:
 *         description: Aplicación instalada exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AppInstallation'
 *       409:
 *         description: La aplicación ya está instalada
 */
router.post('/:appId/install',
  validateParams(commonValidators.uuid),
  validateBody(z.object({
    planId: z.string().uuid().optional(),
    config: z.object({}).optional()
  })),
  appsController.installApp
);

/**
 * @swagger
 * /api/apps/{appId}/uninstall:
 *   post:
 *     summary: Desinstalar una aplicación
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Razón de la desinstalación
 *               keepData:
 *                 type: boolean
 *                 default: false
 *                 description: Mantener datos de la app
 *     responses:
 *       200:
 *         description: Aplicación desinstalada exitosamente
 *       404:
 *         description: La aplicación no está instalada
 */
router.post('/:appId/uninstall',
  validateParams(commonValidators.uuid),
  validateBody(z.object({
    reason: z.string().optional(),
    keepData: z.boolean().default(false)
  })),
  appsController.uninstallApp
);

/**
 * @swagger
 * /api/apps/installed:
 *   get:
 *     summary: Obtener aplicaciones instaladas en el tenant
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: includeUsage
 *         schema:
 *           type: boolean
 *         default: false
 *         description: Incluir información de uso
 *     responses:
 *       200:
 *         description: Lista de aplicaciones instaladas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AppInstallation'
 */
router.get('/installed',
  validateQuery(z.object({
    includeUsage: z.boolean().optional().default(false)
  })),
  appsController.getInstalledApps
);

/**
 * @swagger
 * /api/apps/{appId}/config:
 *   get:
 *     summary: Obtener configuración de una app instalada
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Configuración de la aplicación
 *       404:
 *         description: La aplicación no está instalada
 */
router.get('/:appId/config',
  validateParams(commonValidators.uuid),
  appsController.getAppConfig
);

/**
 * @swagger
 * /api/apps/{appId}/config:
 *   put:
 *     summary: Actualizar configuración de una app instalada
 *     tags: [Apps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: appId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Nueva configuración
 *     responses:
 *       200:
 *         description: Configuración actualizada
 *       404:
 *         description: La aplicación no está instalada
 */
router.put('/:appId/config',
  validateParams(commonValidators.uuid),
  appsController.updateAppConfig
);

export default router;