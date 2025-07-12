import { Router } from 'express';
import { z } from 'zod';
import * as tenantController from '../controllers/tenants.controller';
import { authenticateToken } from '../middleware/auth';
import { requireRole, hasPermission } from '../middleware/authorization';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { createTenantValidator, updateTenantValidator } from '../validators/tenant.validator';
import { commonValidators } from '../middleware/validation';
import { UserRole } from '../constants/roles';
import multer from 'multer';

const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB para logos
});

// Todas las rutas requieren autenticación
router.use(authenticateToken);

/**
 * @swagger
 * /api/tenants:
 *   get:
 *     summary: Obtener empresas del usuario
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filtrar solo activas
 *     responses:
 *       200:
 *         description: Lista de empresas
 */
router.get('/', tenantController.getUserTenants);

/**
 * @swagger
 * /api/tenants:
 *   post:
 *     summary: Crear nueva empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, ruc]
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: "Mi Empresa S.A."
 *               ruc:
 *                 type: string
 *                 example: "12345678901234567890"
 *               direccion:
 *                 type: string
 *               telefono:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               sector:
 *                 type: string
 *                 enum: [retail, services, manufacturing, restaurant, logistics, other]
 *               size:
 *                 type: string
 *                 enum: [small, medium, large, enterprise]
 *     responses:
 *       201:
 *         description: Empresa creada exitosamente
 */
router.post('/',
  validateBody(createTenantValidator),
  tenantController.createTenant
);

/**
 * @swagger
 * /api/tenants/{tenantId}:
 *   get:
 *     summary: Obtener detalles de una empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Detalles de la empresa
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tenant'
 */
router.get('/:tenantId',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  tenantController.getTenantById
);

/**
 * @swagger
 * /api/tenants/{tenantId}:
 *   put:
 *     summary: Actualizar información de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               direccion:
 *                 type: string
 *               telefono:
 *                 type: string
 *               email:
 *                 type: string
 *               configuracion:
 *                 type: object
 *     responses:
 *       200:
 *         description: Empresa actualizada exitosamente
 */
router.put('/:tenantId',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN]),
  validateBody(updateTenantValidator),
  tenantController.updateTenant
);

/**
 * @swagger
 * /api/tenants/{tenantId}/logo:
 *   post:
 *     summary: Actualizar logo de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [logo]
 *             properties:
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Logo actualizado exitosamente
 */
router.post('/:tenantId/logo',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN]),
  upload.single('logo'),
  tenantController.updateLogo
);

/**
 * @swagger
 * /api/tenants/{tenantId}/stats:
 *   get:
 *     summary: Obtener estadísticas de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *           default: 30d
 *     responses:
 *       200:
 *         description: Estadísticas de la empresa
 */
router.get('/:tenantId/stats',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  tenantController.getTenantStats
);

/**
 * @swagger
 * /api/tenants/{tenantId}/usage:
 *   get:
 *     summary: Obtener uso de recursos de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Información de uso
 */
router.get('/:tenantId/usage',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  tenantController.getTenantUsage
);

/**
 * @swagger
 * /api/tenants/{tenantId}/limits:
 *   get:
 *     summary: Obtener límites de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Límites configurados
 */
router.get('/:tenantId/limits',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  tenantController.getTenantLimits
);

/**
 * @swagger
 * /api/tenants/{tenantId}/settings:
 *   get:
 *     summary: Obtener configuración de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Configuración de la empresa
 */
router.get('/:tenantId/settings',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  tenantController.getTenantSettings
);

/**
 * @swagger
 * /api/tenants/{tenantId}/settings:
 *   put:
 *     summary: Actualizar configuración de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Configuración actualizada
 */
router.put('/:tenantId/settings',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN]),
  tenantController.updateTenantSettings
);

/**
 * @swagger
 * /api/tenants/{tenantId}/delete:
 *   post:
 *     summary: Solicitar eliminación de empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
router.post('/:tenantId/delete',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN]),
  tenantController.requestTenantDeletion
);

/**
 * @swagger
 * /api/tenants/{tenantId}/transfer-ownership:
 *   post:
 *     summary: Transferir propiedad de la empresa
 *     tags: [Tenants]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newOwnerId, password]
 *             properties:
 *               newOwnerId:
 *                 type: string
 *                 format: uuid
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Propiedad transferida exitosamente
 */
router.post('/:tenantId/transfer-ownership',
  validateParams(z.object({ tenantId: commonValidators.uuid })),
  injectTenant,
  requireRole([UserRole.ADMIN]),
  tenantController.transferOwnership
);

export default router;
