import { Router } from 'express';
import * as mailController from '../controllers/mail.controller';
import { authenticateToken } from '../middleware/auth';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { checkSubscriptionAccess } from '../middleware/subscription';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  createChannelValidator,
  updateChannelValidator,
  sendMessageValidator,
  updateMessageValidator
} from '../validators/mail.validator';
import { commonValidators } from '../middleware/validation';
import { AppIds } from '../constants/apps';
import { z } from 'zod';
import multer from 'multer';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 25 * 1024 * 1024, // 25MB para attachments
    files: 5
  }
});

// Middleware común
router.use(authenticateToken);
router.use(requireTenant);
router.use(checkSubscriptionAccess(AppIds.MAIL));

/**
 * @swagger
 * /api/mail/channels:
 *   get:
 *     summary: Obtener canales del usuario
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [general, project, department, announcement]
 *       - in: query
 *         name: includePrivate
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de canales
 */
router.get('/channels',
  validateQuery(z.object({
    type: z.enum(['general', 'project', 'department', 'announcement']).optional(),
    includePrivate: z.boolean().optional().default(true),
    search: z.string().optional()
  })),
  mailController.getChannels
);

/**
 * @swagger
 * /api/mail/channels:
 *   post:
 *     summary: Crear nuevo canal
 *     tags: [Mail]
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
 *             required: [name, type]
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 50
 *               description:
 *                 type: string
 *                 maxLength: 200
 *               type:
 *                 type: string
 *                 enum: [general, project, department, announcement]
 *               is_private:
 *                 type: boolean
 *                 default: false
 *               members:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       201:
 *         description: Canal creado exitosamente
 */
router.post('/channels',
  validateBody(createChannelValidator),
  mailController.createChannel
);

/**
 * @swagger
 * /api/mail/channels/{channelId}:
 *   get:
 *     summary: Obtener detalles del canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Detalles del canal
 */
router.get('/channels/:channelId',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  mailController.getChannelById
);

/**
 * @swagger
 * /api/mail/channels/{channelId}:
 *   put:
 *     summary: Actualizar canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
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
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               is_private:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Canal actualizado
 */
router.put('/channels/:channelId',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  validateBody(updateChannelValidator),
  mailController.updateChannel
);

/**
 * @swagger
 * /api/mail/channels/{channelId}:
 *   delete:
 *     summary: Eliminar canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Canal eliminado
 */
router.delete('/channels/:channelId',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  mailController.deleteChannel
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/messages:
 *   get:
 *     summary: Obtener mensajes del canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Lista de mensajes
 */
router.get('/channels/:channelId/messages',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  validateQuery(z.object({
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional()
  })),
  mailController.getChannelMessages
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/messages:
 *   post:
 *     summary: Enviar mensaje al canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *               mentions:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Mensaje enviado
 */
router.post('/channels/:channelId/messages',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  upload.array('attachments', 5),
  validateBody(sendMessageValidator),
  mailController.sendMessage
);

/**
 * @swagger
 * /api/mail/messages/{messageId}:
 *   put:
 *     summary: Editar mensaje
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
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
 *             required: [content]
 *             properties:
 *               content:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4000
 *     responses:
 *       200:
 *         description: Mensaje actualizado
 */
router.put('/messages/:messageId',
  validateParams(z.object({ messageId: commonValidators.uuid })),
  validateBody(updateMessageValidator),
  mailController.updateMessage
);

/**
 * @swagger
 * /api/mail/messages/{messageId}:
 *   delete:
 *     summary: Eliminar mensaje
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Mensaje eliminado
 */
router.delete('/messages/:messageId',
  validateParams(z.object({ messageId: commonValidators.uuid })),
  mailController.deleteMessage
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/members:
 *   get:
 *     summary: Obtener miembros del canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Lista de miembros
 */
router.get('/channels/:channelId/members',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  mailController.getChannelMembers
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/members:
 *   post:
 *     summary: Agregar miembros al canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
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
 *             required: [userIds]
 *             properties:
 *               userIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Miembros agregados
 */
router.post('/channels/:channelId/members',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  mailController.addChannelMembers
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/members/{userId}:
 *   delete:
 *     summary: Remover miembro del canal
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Miembro removido
 */
router.delete('/channels/:channelId/members/:userId',
  validateParams(z.object({ 
    channelId: commonValidators.uuid,
    userId: commonValidators.uuid
  })),
  mailController.removeChannelMember
);

/**
 * @swagger
 * /api/mail/channels/{channelId}/typing:
 *   post:
 *     summary: Indicador de escritura
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: channelId
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
 *             required: [isTyping]
 *             properties:
 *               isTyping:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Estado actualizado
 */
router.post('/channels/:channelId/typing',
  validateParams(z.object({ channelId: commonValidators.uuid })),
  mailController.setTypingStatus
);

/**
 * @swagger
 * /api/mail/direct-messages/{userId}:
 *   get:
 *     summary: Obtener mensajes directos con un usuario
 *     tags: [Mail]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Mensajes directos
 */
router.get('/direct-messages/:userId',
  validateParams(z.object({ userId: commonValidators.uuid })),
  mailController.getDirectMessages
);

/**
 * @swagger
 * /api/mail/search:
 *   get:
 *     summary: Buscar mensajes
 *     tags: [Mail]
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
 *         name: channelId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: userId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: dateFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: dateTo
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 */
router.get('/search',
  validateQuery(z.object({
    q: z.string().min(2),
    channelId: commonValidators.uuid.optional(),
    userId: commonValidators.uuid.optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional()
  })),
  mailController.searchMessages
);

export default router;
