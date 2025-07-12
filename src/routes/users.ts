import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { UserService } from '@/services/user.service';

const router = Router();
const userService = new UserService();

// GET /api/users/me - Get current user profile (same as /api/auth/me for compatibility)
router.get('/me', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    // Return user profile data compatible with frontend expectations
    const userData = {
      id: req.user.id,
      email: req.user.email,
      phone: req.user.phone,
      full_name: req.user.name, // Frontend expects 'full_name'
      name: req.user.name, // Keep both for compatibility
      avatar_url: req.user.avatar_url,
      created_at: req.user.created_at,
      updated_at: req.user.updated_at,
      last_login: req.user.last_login_at,
      two_factor_enabled: req.user.two_factor_enabled || false,
      status: req.user.status || 'active'
    };
    return success(res, userData);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PATCH /api/users/me - Update user profile
router.patch('/me', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    const updatedUser = await userService.updateProfile(req.user.id, req.body);
    return success(res, updatedUser);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/users/change-password - Change user password
router.post('/change-password', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    await userService.changePassword(req.user.id, req.body);
    return success(res, { message: 'Password changed successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as userRoutes };