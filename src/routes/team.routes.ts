import { Router } from 'express';
import * as teamController from '../controllers/team.controller';
import { authenticateToken } from '../middleware/auth';
import { requireRole, canManageUser } from '../middleware/authorization';
import { injectTenant, requireTenant } from '../middleware/tenant';
import { validateBody, validateParams, validateQuery } from '../middleware/validation';
import { 
  inviteMemberValidator,
  updateMemberValidator,
  bulkInviteValidator 
} from '../validators/team.validator';
import { commonValidators } from '../middleware/validation';
import { UserRole } from '../constants/roles';
import { z } from 'zod';

const router = Router();

// Todas las rutas requieren autenticación y tenant
router.use(authenticateToken);
router.use(requireTenant);

/**
 * @swagger
 * /api/team/members:
 *   get:
 *     summary: Obtener miembros del equipo
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, manager, miembro, viewer]
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Lista de miembros del equipo
 */
router.get('/members',
  validateQuery(z.object({
    ...commonValidators.pagination.shape,
    search: z.string().optional(),
    role: z.enum(['admin', 'manager', 'miembro', 'viewer']).optional(),
    active: z.boolean().optional()
  })),
  teamController.getTeamMembers
);

/**
 * @swagger
 * /api/team/members/{memberId}:
 *   get:
 *     summary: Obtener detalles de un miembro
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Detalles del miembro
 */
router.get('/members/:memberId',
  validateParams(z.object({ memberId: commonValidators.uuid })),
  teamController.getMemberById
);

/**
 * @swagger
 * /api/team/invite:
 *   post:
 *     summary: Invitar usuario al equipo
 *     tags: [Team]
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
 *             required: [identifier, rol]
 *             properties:
 *               identifier:
 *                 type: string
 *                 description: Email o teléfono
 *               rol:
 *                 type: string
 *                 enum: [admin, manager, miembro, viewer]
 *                 default: miembro
 *               message:
 *                 type: string
 *               expires_in_hours:
 *                 type: integer
 *                 default: 72
 *     responses:
 *       200:
 *         description: Invitación enviada o usuario agregado
 */
router.post('/invite',
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  validateBody(inviteMemberValidator),
  teamController.inviteMember
);

/**
 * @swagger
 * /api/team/bulk-invite:
 *   post:
 *     summary: Invitar múltiples usuarios
 *     tags: [Team]
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
 *             required: [invitations]
 *             properties:
 *               invitations:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     identifier:
 *                       type: string
 *                     rol:
 *                       type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Invitaciones procesadas
 */
router.post('/bulk-invite',
  requireRole([UserRole.ADMIN]),
  validateBody(bulkInviteValidator),
  teamController.bulkInvite
);

/**
 * @swagger
 * /api/team/members/{memberId}:
 *   put:
 *     summary: Actualizar miembro del equipo
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
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
 *               rol:
 *                 type: string
 *                 enum: [admin, manager, miembro, viewer]
 *               activo:
 *                 type: boolean
 *               permisos:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Miembro actualizado exitosamente
 */
router.put('/members/:memberId',
  validateParams(z.object({ memberId: commonValidators.uuid })),
  requireRole([UserRole.ADMIN]),
  canManageUser,
  validateBody(updateMemberValidator),
  teamController.updateMember
);

/**
 * @swagger
 * /api/team/members/{memberId}:
 *   delete:
 *     summary: Remover miembro del equipo
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Miembro removido exitosamente
 */
router.delete('/members/:memberId',
  validateParams(z.object({ memberId: commonValidators.uuid })),
  requireRole([UserRole.ADMIN]),
  canManageUser,
  teamController.removeMember
);

/**
 * @swagger
 * /api/team/invitations:
 *   get:
 *     summary: Obtener invitaciones pendientes
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Lista de invitaciones pendientes
 */
router.get('/invitations',
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  teamController.getPendingInvitations
);

/**
 * @swagger
 * /api/team/invitations/{invitationId}:
 *   delete:
 *     summary: Cancelar invitación
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Invitación cancelada
 */
router.delete('/invitations/:invitationId',
  validateParams(z.object({ invitationId: commonValidators.uuid })),
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  teamController.cancelInvitation
);

/**
 * @swagger
 * /api/team/invitations/{invitationId}/resend:
 *   post:
 *     summary: Reenviar invitación
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - $ref: '#/components/parameters/TenantId'
 *     responses:
 *       200:
 *         description: Invitación reenviada
 */
router.post('/invitations/:invitationId/resend',
  validateParams(z.object({ invitationId: commonValidators.uuid })),
  requireRole([UserRole.ADMIN, UserRole.MANAGER]),
  teamController.resendInvitation
);

/**
 * @swagger
 * /api/team/accept-invitation:
 *   post:
 *     summary: Aceptar invitación (público)
 *     tags: [Team]
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
 *         description: Invitación aceptada
 */
router.post('/accept-invitation',
  teamController.acceptInvitation
);

/**
 * @swagger
 * /api/team/permissions:
 *   get:
 *     summary: Obtener permisos disponibles
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de permisos
 */
router.get('/permissions',
  teamController.getAvailablePermissions
);

/**
 * @swagger
 * /api/team/roles:
 *   get:
 *     summary: Obtener roles disponibles
 *     tags: [Team]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de roles con sus permisos
 */
router.get('/roles',
  teamController.getAvailableRoles
);

export default router;
