import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { individualOrCompanyMode } from '@/middleware/tenant';
import { EmbeddedUserService } from '@/services/embedded-user.service';

const router = Router();
const embeddedUserService = new EmbeddedUserService();

// All endpoints require authentication and support both individual/company modes
router.use(authenticate);
router.use(individualOrCompanyMode);

// =====================================================
// EMBEDDED USER MANAGEMENT APIs
// Standard contract for all apps to manage their users
// =====================================================

// GET /api/embedded-users/:appId - Get users for specific app
router.get('/:appId', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    const contextId = req.user.is_individual_mode ? req.user.id : req.company.id;
    const contextType = req.user.is_individual_mode ? 'user' : 'company';
    
    const users = await embeddedUserService.getAppUsers(appId, contextId, contextType);
    return success(res, users);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/embedded-users/:appId/invite - Invite user to app
router.post('/:appId/invite', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    const { email, phone, role, permissions } = req.body;
    
    // Individual mode: only owner can invite (but limited scope)
    if (req.user.is_individual_mode) {
      return error(res, 'Cannot invite users in individual mode', 403);
    }
    
    const contextId = req.company.id;
    const invitation = await embeddedUserService.inviteToApp(
      appId, 
      contextId, 
      { email, phone, role, permissions },
      req.user.id
    );
    
    return success(res, invitation, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PATCH /api/embedded-users/:appId/members/:userId - Update user permissions in app
router.patch('/:appId/members/:userId', safeAsync(async (req: any, res: any) => {
  try {
    const { appId, userId } = req.params;
    const { permissions, role } = req.body;
    
    if (req.user.is_individual_mode) {
      return error(res, 'Cannot manage users in individual mode', 403);
    }
    
    const contextId = req.company.id;
    const updatedMember = await embeddedUserService.updateAppMember(
      appId,
      contextId,
      userId,
      { permissions, role },
      req.user.id
    );
    
    return success(res, updatedMember);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// DELETE /api/embedded-users/:appId/members/:userId - Remove user from app
router.delete('/:appId/members/:userId', safeAsync(async (req: any, res: any) => {
  try {
    const { appId, userId } = req.params;
    
    if (req.user.is_individual_mode) {
      return error(res, 'Cannot manage users in individual mode', 403);
    }
    
    const contextId = req.company.id;
    await embeddedUserService.removeFromApp(appId, contextId, userId, req.user.id);
    
    return success(res, { message: 'User removed from app successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/embedded-users/:appId/available - Get available users to invite
router.get('/:appId/available', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    
    if (req.user.is_individual_mode) {
      return success(res, []); // No users to invite in individual mode
    }
    
    const contextId = req.company.id;
    const availableUsers = await embeddedUserService.getAvailableUsers(appId, contextId);
    
    return success(res, availableUsers);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/embedded-users/:appId/permissions - Get app-specific permission templates
router.get('/:appId/permissions', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    const permissions = await embeddedUserService.getAppPermissions(appId);
    
    return success(res, permissions);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as embeddedUsersRoutes };