import { Router } from 'express';
import * as subscriptionController from '../controllers/subscriptions.controller';
import { authenticateToken } from '../middleware/auth';
import { requireRole } from '../middleware/authorization';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  subscribeValidator,
  updateSubscriptionValidator,
  cancelSubscriptionValidator,
  addAddonValidator
} from '../validators/subscription.validator';
import { commonValidators } from '../middleware/validation';
import { UserRole } from '../constants/roles';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/subscriptions/plans:
 *   get:
 *     summary: Obtener planes disponibles
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: appId
 *         schema:
 *           type: string
 *         description: Filtrar por app específica
 *       - in: query
 *         name: includeAddons
 *         schema:
 *           type: boolean
 *         default: true
 *     responses:
 *       200:
 *         description: Lista de planes disponibles
 */
router.get('/plans',
  validateQuery(z.object({
    appId: z.string().optional(),
    includeAddons: z.boolean().optional().default(true)
  })),
  subscriptionController.getAvailablePlans
);

/**
 * @swagger
 * /api/subscriptions/current:
 *   get:
 *     summary: Obtener suscripciones actuales del tenant
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Suscripciones actuales
 */
router.get('/current',
  requireTenant,
  subscriptionController.getCurrentSubscriptions
);

/**
 * @swagger
 * /api/subscriptions/usage:
 *   get:
 *     summary: Obtener uso actual vs límites
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: appId
 *         schema:
 *           type: string
 *         description: Filtrar por app específica
 *     responses:
 *       200:
 *         description: Información de uso y límites
 */
router.get('/usage',
  requireTenant,
  subscriptionController.getUsageInfo
);

/**
 * @swagger
 * /api/subscriptions/subscribe:
 *   post:
 *     summary: Suscribirse a un plan
 *     tags: [Subscriptions]
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
 *             required: [planId]
 *             properties:
 *               planId:
 *                 type: string
 *                 format: uuid
 *               billingCycle:
 *                 type: string
 *                 enum: [monthly, yearly]
 *                 default: monthly
 *               addons:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     quantity:
 *                       type: integer
 *                       minimum: 1
 *               coupon:
 *                 type: string
 *               paymentMethodId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Suscripción creada exitosamente
 */
router.post('/subscribe',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateBody(subscribeValidator),
  subscriptionController.subscribe
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}:
 *   get:
 *     summary: Obtener detalles de una suscripción
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Detalles de la suscripción
 */
router.get('/:subscriptionId',
  validateParams(z.object({ subscriptionId: commonValidators.uuid })),
  requireTenant,
  subscriptionController.getSubscriptionById
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}:
 *   put:
 *     summary: Actualizar suscripción (cambiar plan)
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
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
 *             required: [planId]
 *             properties:
 *               planId:
 *                 type: string
 *                 format: uuid
 *               billingCycle:
 *                 type: string
 *                 enum: [monthly, yearly]
 *               immediate:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: Suscripción actualizada
 */
router.put('/:subscriptionId',
  validateParams(z.object({ subscriptionId: commonValidators.uuid })),
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateBody(updateSubscriptionValidator),
  subscriptionController.updateSubscription
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}/cancel:
 *   post:
 *     summary: Cancelar suscripción
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
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
 *               immediate:
 *                 type: boolean
 *                 default: false
 *               reason:
 *                 type: string
 *               feedback:
 *                 type: string
 *     responses:
 *       200:
 *         description: Suscripción cancelada
 */
router.post('/:subscriptionId/cancel',
  validateParams(z.object({ subscriptionId: commonValidators.uuid })),
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateBody(cancelSubscriptionValidator),
  subscriptionController.cancelSubscription
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}/reactivate:
 *   post:
 *     summary: Reactivar suscripción cancelada
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Suscripción reactivada
 */
router.post('/:subscriptionId/reactivate',
  validateParams(z.object({ subscriptionId: commonValidators.uuid })),
  requireTenant,
  requireRole([UserRole.ADMIN]),
  subscriptionController.reactivateSubscription
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}/addons:
 *   post:
 *     summary: Agregar addon a suscripción
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
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
 *             required: [addonId, quantity]
 *             properties:
 *               addonId:
 *                 type: string
 *                 format: uuid
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 default: 1
 *     responses:
 *       200:
 *         description: Addon agregado
 */
router.post('/:subscriptionId/addons',
  validateParams(z.object({ subscriptionId: commonValidators.uuid })),
  requireTenant,
  requireRole([UserRole.ADMIN]),
  validateBody(addAddonValidator),
  subscriptionController.addAddon
);

/**
 * @swagger
 * /api/subscriptions/{subscriptionId}/addons/{addonId}:
 *   delete:
 *     summary: Remover addon de suscripción
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: addonId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Addon removido
 */
router.delete('/:subscriptionId/addons/:addonId',
  validateParams(z.object({ 
    subscriptionId: commonValidators.uuid,
    addonId: commonValidators.uuid
  })),
  requireTenant,
  requireRole([UserRole.ADMIN]),
  subscriptionController.removeAddon
);

/**
 * @swagger
 * /api/subscriptions/history:
 *   get:
 *     summary: Obtener historial de suscripciones
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Historial de cambios
 */
router.get('/history',
  requireTenant,
  validateQuery(commonValidators.pagination),
  subscriptionController.getSubscriptionHistory
);

/**
 * @swagger
 * /api/subscriptions/preview-change:
 *   post:
 *     summary: Previsualizar cambio de plan
 *     tags: [Subscriptions]
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
 *             required: [currentSubscriptionId, newPlanId]
 *             properties:
 *               currentSubscriptionId:
 *                 type: string
 *                 format: uuid
 *               newPlanId:
 *                 type: string
 *                 format: uuid
 *               billingCycle:
 *                 type: string
 *                 enum: [monthly, yearly]
 *     responses:
 *       200:
 *         description: Preview del cambio
 */
router.post('/preview-change',
  requireTenant,
  requireRole([UserRole.ADMIN]),
  subscriptionController.previewPlanChange
);

export default router;
