import { Router } from 'express';
import * as userController from '../controllers/users.controller';
import { authenticateToken } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validation';
import { uploadLimiter } from '../middleware/rateLimiter';
import { 
  updateProfileValidator,
  updateSettingsValidator,
  updateAvatarValidator 
} from '../validators/user.validator';
import { commonValidators } from '../middleware/validation';
import multer from 'multer';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB para avatars
});

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/users/me:
 *   get:
 *     summary: Obtener perfil del usuario actual
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Perfil del usuario
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 */
router.get('/me', userController.getProfile);

/**
 * @swagger
 * /api/users/me:
 *   put:
 *     summary: Actualizar perfil del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               apellido:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               telefono:
 *                 type: string
 *     responses:
 *       200:
 *         description: Perfil actualizado exitosamente
 */
router.put('/me', 
  validateBody(updateProfileValidator),
  userController.updateProfile
);

/**
 * @swagger
 * /api/users/me/avatar:
 *   post:
 *     summary: Actualizar avatar del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar actualizado exitosamente
 */
router.post('/me/avatar',
  uploadLimiter,
  upload.single('avatar'),
  validateBody(updateAvatarValidator),
  userController.updateAvatar
);

/**
 * @swagger
 * /api/users/me/avatar:
 *   delete:
 *     summary: Eliminar avatar del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Avatar eliminado exitosamente
 */
router.delete('/me/avatar', userController.deleteAvatar);

/**
 * @swagger
 * /api/users/me/settings:
 *   get:
 *     summary: Obtener configuraciones del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Configuraciones del usuario
 */
router.get('/me/settings', userController.getSettings);

/**
 * @swagger
 * /api/users/me/settings:
 *   put:
 *     summary: Actualizar configuraciones del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               theme:
 *                 type: string
 *                 enum: [light, dark, auto]
 *               language:
 *                 type: string
 *                 enum: [es, en]
 *               timezone:
 *                 type: string
 *               notifications:
 *                 type: object
 *                 properties:
 *                   email:
 *                     type: boolean
 *                   push:
 *                     type: boolean
 *                   sms:
 *                     type: boolean
 *                   marketing:
 *                     type: boolean
 *     responses:
 *       200:
 *         description: Configuraciones actualizadas exitosamente
 */
router.put('/me/settings',
  validateBody(updateSettingsValidator),
  userController.updateSettings
);

/**
 * @swagger
 * /api/users/me/tenants:
 *   get:
 *     summary: Obtener empresas del usuario
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de empresas donde el usuario es miembro
 */
router.get('/me/tenants', userController.getUserTenants);

/**
 * @swagger
 * /api/users/me/notifications-preferences:
 *   get:
 *     summary: Obtener preferencias de notificaciones
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Preferencias de notificaciones
 */
router.get('/me/notifications-preferences', userController.getNotificationPreferences);

/**
 * @swagger
 * /api/users/me/notifications-preferences:
 *   put:
 *     summary: Actualizar preferencias de notificaciones
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email_notifications:
 *                 type: boolean
 *               push_notifications:
 *                 type: boolean
 *               sms_notifications:
 *                 type: boolean
 *               notification_types:
 *                 type: object
 *     responses:
 *       200:
 *         description: Preferencias actualizadas exitosamente
 */
router.put('/me/notifications-preferences', userController.updateNotificationPreferences);

/**
 * @swagger
 * /api/users/me/delete:
 *   post:
 *     summary: Solicitar eliminación de cuenta
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password, confirmation]
 *             properties:
 *               password:
 *                 type: string
 *               confirmation:
 *                 type: string
 *                 example: "DELETE"
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Solicitud de eliminación procesada
 */
router.post('/me/delete', userController.requestAccountDeletion);

/**
 * @swagger
 * /api/users/me/export:
 *   get:
 *     summary: Exportar datos del usuario (GDPR)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Datos del usuario exportados
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/me/export', userController.exportUserData);

/**
 * @swagger
 * /api/users/{userId}:
 *   get:
 *     summary: Obtener información de otro usuario (mismo tenant)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Información del usuario
 *       403:
 *         description: Sin acceso al usuario
 */
router.get('/:userId',
  validateParams(commonValidators.uuid),
  userController.getUserById
);

/**
 * @swagger
 * /api/users/search:
 *   get:
 *     summary: Buscar usuarios en el tenant
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Término de búsqueda
 *       - in: query
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Resultados de búsqueda
 */
router.get('/search', userController.searchUsers);

export default router;
