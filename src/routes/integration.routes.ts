import { Router } from 'express';
import * as integrationController from '../controllers/integration.controller';
import { authenticateToken, authenticateApiKey } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  validateAccessValidator,
  shareDataValidator,
  createWebhookValidator
} from '../validators/integration.validator';
import { commonValidators } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

/**
 * @swagger
 * /api/integration/validate-access:
 *   post:
 *     summary: Validar acceso entre aplicaciones
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sourceApp, targetApp, resource, action]
 *             properties:
 *               sourceApp:
 *                 type: string
 *                 description: App que solicita acceso
 *               targetApp:
 *                 type: string
 *                 description: App que contiene el recurso
 *               resource:
 *                 type: string
 *                 description: Tipo de recurso
 *               action:
 *                 type: string
 *                 enum: [read, write, delete]
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Acceso validado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 allowed:
 *                   type: boolean
 *                 reason:
 *                   type: string
 *                 permissions:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.post('/validate-access',
  authenticateToken,
  validateBody(validateAccessValidator),
  integrationController.validateAccess
);

/**
 * @swagger
 * /api/integration/share-data:
 *   post:
 *     summary: Compartir datos entre aplicaciones
 *     tags: [Integration]
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
 *             required: [sourceApp, targetApp, dataType, data]
 *             properties:
 *               sourceApp:
 *                 type: string
 *               targetApp:
 *                 type: string
 *               dataType:
 *                 type: string
 *                 enum: [customer, product, invoice, order, inventory]
 *               data:
 *                 type: object
 *                 description: Datos a compartir
 *               options:
 *                 type: object
 *                 properties:
 *                   sync:
 *                     type: boolean
 *                     default: false
 *                   overwrite:
 *                     type: boolean
 *                     default: false
 *                   mappings:
 *                     type: object
 *     responses:
 *       201:
 *         description: Datos compartidos exitosamente
 */
router.post('/share-data',
  authenticateToken,
  validateBody(shareDataValidator),
  integrationController.shareData
);

/**
 * @swagger
 * /api/integration/shared-resources:
 *   get:
 *     summary: Obtener recursos compartidos
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/AppId'
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum: [incoming, outgoing, both]
 *           default: both
 *       - in: query
 *         name: resourceType
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de recursos compartidos
 */
router.get('/shared-resources',
  authenticateToken,
  validateQuery(z.object({
    direction: z.enum(['incoming', 'outgoing', 'both']).optional().default('both'),
    resourceType: z.string().optional()
  })),
  integrationController.getSharedResources
);

/**
 * @swagger
 * /api/integration/sync:
 *   post:
 *     summary: Sincronizar datos entre aplicaciones
 *     tags: [Integration]
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
 *             required: [sourceApp, targetApp, syncType]
 *             properties:
 *               sourceApp:
 *                 type: string
 *               targetApp:
 *                 type: string
 *               syncType:
 *                 type: string
 *                 enum: [full, incremental, selective]
 *               entities:
 *                 type: array
 *                 items:
 *                   type: string
 *               lastSyncTime:
 *                 type: string
 *                 format: date-time
 *               options:
 *                 type: object
 *     responses:
 *       200:
 *         description: Sincronización iniciada
 */
router.post('/sync',
  authenticateToken,
  integrationController.syncData
);

/**
 * @swagger
 * /api/integration/webhooks:
 *   get:
 *     summary: Listar webhooks configurados
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/AppId'
 *     responses:
 *       200:
 *         description: Lista de webhooks
 */
router.get('/webhooks',
  authenticateToken,
  integrationController.getWebhooks
);

/**
 * @swagger
 * /api/integration/webhooks:
 *   post:
 *     summary: Crear webhook
 *     tags: [Integration]
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
 *             required: [url, events, appId]
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *               appId:
 *                 type: string
 *               secret:
 *                 type: string
 *               active:
 *                 type: boolean
 *                 default: true
 *               headers:
 *                 type: object
 *     responses:
 *       201:
 *         description: Webhook creado
 */
router.post('/webhooks',
  authenticateToken,
  validateBody(createWebhookValidator),
  integrationController.createWebhook
);

/**
 * @swagger
 * /api/integration/webhooks/{webhookId}:
 *   put:
 *     summary: Actualizar webhook
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: webhookId
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
 *             properties:
 *               url:
 *                 type: string
 *                 format: uri
 *               events:
 *                 type: array
 *                 items:
 *                   type: string
 *               active:
 *                 type: boolean
 *               headers:
 *                 type: object
 *     responses:
 *       200:
 *         description: Webhook actualizado
 */
router.put('/webhooks/:webhookId',
  authenticateToken,
  validateParams(z.object({ webhookId: commonValidators.uuid })),
  integrationController.updateWebhook
);

/**
 * @swagger
 * /api/integration/webhooks/{webhookId}:
 *   delete:
 *     summary: Eliminar webhook
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Webhook eliminado
 */
router.delete('/webhooks/:webhookId',
  authenticateToken,
  validateParams(z.object({ webhookId: commonValidators.uuid })),
  integrationController.deleteWebhook
);

/**
 * @swagger
 * /api/integration/webhooks/{webhookId}/test:
 *   post:
 *     summary: Probar webhook
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Webhook probado
 */
router.post('/webhooks/:webhookId/test',
  authenticateToken,
  validateParams(z.object({ webhookId: commonValidators.uuid })),
  integrationController.testWebhook
);

/**
 * @swagger
 * /api/integration/api-keys:
 *   get:
 *     summary: Listar API keys
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Lista de API keys
 */
router.get('/api-keys',
  authenticateToken,
  integrationController.getApiKeys
);

/**
 * @swagger
 * /api/integration/api-keys:
 *   post:
 *     summary: Crear API key
 *     tags: [Integration]
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
 *             required: [name, appId]
 *             properties:
 *               name:
 *                 type: string
 *               appId:
 *                 type: string
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: API key creada
 */
router.post('/api-keys',
  authenticateToken,
  integrationController.createApiKey
);

/**
 * @swagger
 * /api/integration/api-keys/{keyId}:
 *   delete:
 *     summary: Revocar API key
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: API key revocada
 */
router.delete('/api-keys/:keyId',
  authenticateToken,
  validateParams(z.object({ keyId: commonValidators.uuid })),
  integrationController.revokeApiKey
);

export default router;
