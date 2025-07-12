import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticateToken, optionalAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { authLimiter } from '../middleware/rateLimiter';
import { 
  loginValidator,
  registerValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
  refreshTokenValidator,
  selectTenantValidator
} from '../utils/validators';

const router = Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registrar nuevo usuario
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, apellido, telefono, password, terms_accepted]
 *             properties:
 *               nombre:
 *                 type: string
 *                 minLength: 2
 *                 example: "Juan Carlos"
 *               apellido:
 *                 type: string
 *                 minLength: 2
 *                 example: "Rodríguez"
 *               telefono:
 *                 type: string
 *                 example: "+50761234567"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "juan@empresa.com"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "MiPassword123!"
 *               terms_accepted:
 *                 type: boolean
 *                 example: true
 *               marketing_consent:
 *                 type: boolean
 *                 example: false
 *     responses:
 *       201:
 *         description: Usuario registrado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       400:
 *         $ref: '#/components/responses/ValidationError'
 */
router.post('/register', 
  authLimiter,
  validateBody(registerValidator),
  authController.register
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier, password]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Teléfono, email personal o email @forvara.mail
 *                 example: "+50761234567"
 *               password:
 *                 type: string
 *                 example: "MiPassword123!"
 *               remember_me:
 *                 type: boolean
 *                 default: false
 *               device_info:
 *                 type: object
 *                 properties:
 *                   platform:
 *                     type: string
 *                   browser:
 *                     type: string
 *                   version:
 *                     type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/login',
  authLimiter,
  validateBody(loginValidator),
  authController.login
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cerrar sesión
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sesión cerrada exitosamente
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/logout',
  authenticateToken,
  authController.logout
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refrescar token de acceso
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refrescado exitosamente
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post('/refresh',
  optionalAuth,
  validateBody(refreshTokenValidator),
  authController.refreshToken
);

/**
 * @swagger
 * /api/auth/select-tenant:
 *   post:
 *     summary: Seleccionar tenant activo
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tenantId]
 *             properties:
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *                 example: "123e4567-e89b-12d3-a456-426614174000"
 *     responses:
 *       200:
 *         description: Tenant seleccionado exitosamente
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post('/select-tenant',
  authenticateToken,
  validateBody(selectTenantValidator),
  authController.selectTenant
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Solicitar restablecimiento de contraseña
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [identifier]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email o teléfono
 *                 example: "juan@empresa.com"
 *     responses:
 *       200:
 *         description: Email de restablecimiento enviado
 *       429:
 *         description: Demasiadas solicitudes
 */
router.post('/forgot-password',
  authLimiter,
  validateBody(forgotPasswordValidator),
  authController.forgotPassword
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Restablecer contraseña con token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:
 *                 type: string
 *                 example: "reset_token_here"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "NuevaPassword123!"
 *     responses:
 *       200:
 *         description: Contraseña restablecida exitosamente
 *       400:
 *         description: Token inválido o expirado
 */
router.post('/reset-password',
  authLimiter,
  validateBody(resetPasswordValidator),
  authController.resetPassword
);

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Cambiar contraseña (usuario autenticado)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [current_password, new_password]
 *             properties:
 *               current_password:
 *                 type: string
 *               new_password:
 *                 type: string
 *                 minLength: 8
 *               logout_other_sessions:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Contraseña cambiada exitosamente
 *       400:
 *         description: Contraseña actual incorrecta
 */
router.put('/change-password',
  authenticateToken,
  validateBody(changePasswordValidator),
  authController.changePassword
);

/**
 * @swagger
 * /api/auth/sessions:
 *   get:
 *     summary: Obtener sesiones activas del usuario
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de sesiones activas
 */
router.get('/sessions',
  authenticateToken,
  authController.getSessions
);

/**
 * @swagger
 * /api/auth/sessions/{sessionId}:
 *   delete:
 *     summary: Terminar una sesión específica
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Sesión terminada exitosamente
 *       404:
 *         description: Sesión no encontrada
 */
router.delete('/sessions/:sessionId',
  authenticateToken,
  authController.terminateSession
);

/**
 * @swagger
 * /api/auth/verify-email:
 *   post:
 *     summary: Verificar email con token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Email verificado exitosamente
 */
router.post('/verify-email',
  authController.verifyEmail
);

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Reenviar email de verificación
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Email de verificación reenviado
 *       429:
 *         description: Demasiadas solicitudes
 */
router.post('/resend-verification',
  authenticateToken,
  authLimiter,
  authController.resendVerification
);

/**
 * @swagger
 * /api/auth/2fa/enable:
 *   post:
 *     summary: Habilitar autenticación de dos factores
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: 2FA habilitado, QR code generado
 */
router.post('/2fa/enable',
  authenticateToken,
  authController.enable2FA
);

/**
 * @swagger
 * /api/auth/2fa/verify:
 *   post:
 *     summary: Verificar código 2FA
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Código verificado exitosamente
 */
router.post('/2fa/verify',
  authenticateToken,
  authController.verify2FA
);

export default router;
