import { Router } from 'express';
import * as notificationController from '../controllers/notifications.controller';
import { authenticateToken } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  markReadValidator,
  updatePreferencesValidator 
} from '../validators/notification.validator';
import { commonValidators } from '../middleware/validation';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Obtener notificaciones del usuario
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [info, success, warning, error, team_invite, subscription_update, etc]
 *       - in: query
 *         name: isRead
 *         schema:
 *           type: boolean
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
 *     responses:
 *       200:
 *         description: Lista de notificaciones
 */
router.get('/',
  validateQuery(z.object({
    ...commonValidators.pagination.shape,
    type: z.string().optional(),
    isRead: z.boolean().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
  })),
  notificationController.getNotifications
);

/**
 * @swagger
 * /api/notifications/unread-count:
 *   get:
 *     summary: Obtener contador de no leídas
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Contador de notificaciones no leídas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 byType:
 *                   type: object
 */
router.get('/unread-count',
  notificationController.getUnreadCount
);

/**
 * @swagger
 * /api/notifications/{notificationId}:
 *   get:
 *     summary: Obtener detalle de notificación
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Detalle de la notificación
 */
router.get('/:notificationId',
  validateParams(z.object({ notificationId: commonValidators.uuid })),
  notificationController.getNotificationById
);

/**
 * @swagger
 * /api/notifications/mark-read:
 *   post:
 *     summary: Marcar notificaciones como leídas
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notificationIds]
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Notificaciones marcadas como leídas
 */
router.post('/mark-read',
  validateBody(markReadValidator),
  notificationController.markAsRead
);

/**
 * @swagger
 * /api/notifications/mark-all-read:
 *   post:
 *     summary: Marcar todas como leídas
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 description: Filtrar por tipo (opcional)
 *     responses:
 *       200:
 *         description: Todas las notificaciones marcadas como leídas
 */
router.post('/mark-all-read',
  notificationController.markAllAsRead
);

/**
 * @swagger
 * /api/notifications/{notificationId}:
 *   delete:
 *     summary: Eliminar notificación
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Notificación eliminada
 */
router.delete('/:notificationId',
  validateParams(z.object({ notificationId: commonValidators.uuid })),
  notificationController.deleteNotification
);

/**
 * @swagger
 * /api/notifications/bulk-delete:
 *   post:
 *     summary: Eliminar múltiples notificaciones
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [notificationIds]
 *             properties:
 *               notificationIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Notificaciones eliminadas
 */
router.post('/bulk-delete',
  notificationController.bulkDelete
);

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Obtener preferencias de notificaciones
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferencias del usuario
 */
router.get('/preferences',
  notificationController.getPreferences
);

/**
 * @swagger
 * /api/notifications/preferences:
 *   put:
 *     summary: Actualizar preferencias de notificaciones
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channels:
 *                 type: object
 *                 properties:
 *                   email:
 *                     type: boolean
 *                   push:
 *                     type: boolean
 *                   sms:
 *                     type: boolean
 *                   inApp:
 *                     type: boolean
 *               types:
 *                 type: object
 *                 additionalProperties:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     channels:
 *                       type: array
 *                       items:
 *                         type: string
 *               quietHours:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   from:
 *                     type: string
 *                     pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                   to:
 *                     type: string
 *                     pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
 *                   timezone:
 *                     type: string
 *     responses:
 *       200:
 *         description: Preferencias actualizadas
 */
router.put('/preferences',
  validateBody(updatePreferencesValidator),
  notificationController.updatePreferences
);

/**
 * @swagger
 * /api/notifications/test:
 *   post:
 *     summary: Enviar notificación de prueba
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, channel]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [info, success, warning, error]
 *               channel:
 *                 type: string
 *                 enum: [email, push, sms, inApp]
 *     responses:
 *       200:
 *         description: Notificación de prueba enviada
 */
router.post('/test',
  notificationController.sendTestNotification
);

/**
 * @swagger
 * /api/notifications/subscribe:
 *   post:
 *     summary: Suscribirse a push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subscription]
 *             properties:
 *               subscription:
 *                 type: object
 *                 properties:
 *                   endpoint:
 *                     type: string
 *                   keys:
 *                     type: object
 *                     properties:
 *                       p256dh:
 *                         type: string
 *                       auth:
 *                         type: string
 *               deviceInfo:
 *                 type: object
 *                 properties:
 *                   platform:
 *                     type: string
 *                   browser:
 *                     type: string
 *                   version:
 *                     type: string
 *     responses:
 *       201:
 *         description: Suscripción creada
 */
router.post('/subscribe',
  notificationController.subscribeToPush
);

/**
 * @swagger
 * /api/notifications/unsubscribe:
 *   post:
 *     summary: Desuscribirse de push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [endpoint]
 *             properties:
 *               endpoint:
 *                 type: string
 *     responses:
 *       200:
 *         description: Desuscripción exitosa
 */
router.post('/unsubscribe',
  notificationController.unsubscribeFromPush
);

export default router;
