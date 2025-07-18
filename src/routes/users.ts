import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { requireTenant } from '@/middleware/tenant';
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

// PATCH /api/users/:id - Update user by ID (alias for /me when ID matches)
router.patch('/:id', authenticate, safeAsync(async (req: any, res: any) => {
  const { id } = req.params;
  
  // Only allow users to update their own profile
  if (id !== req.user.id) {
    return error(res, 'Unauthorized to update this profile', 403);
  }
  
  try {
    const updatedUser = await userService.updateProfile(id, req.body);
    return success(res, updatedUser);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PATCH /api/users/notifications - Update notification preferences
router.patch('/notifications', authenticate, safeAsync(async (req: any, res: any) => {
  const { email_notifications, sms_notifications, marketing_emails } = req.body;
  
  try {
    const updatedUser = await userService.updateNotificationPreferences(req.user.id, {
      email_notifications,
      sms_notifications,
      marketing_emails
    });
    return success(res, updatedUser);
  } catch (err: any) {
    return error(res, err.message || 'Failed to update notifications', 400);
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

// GET /api/users/company-members - Get company members for delegation
router.get('/company-members', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const members = await userService.getCompanyMembers(req.company.id);
    return success(res, members);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/users/settings - Get user settings
router.get('/settings', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    const settings = {
      // Profile
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      email: req.user.email,
      phone: req.user.phone,
      avatar_url: req.user.avatar_url,
      bio: req.user.bio,
      
      // Preferences
      language: req.user.preferred_language || 'es',
      timezone: req.user.timezone || 'America/Panama',
      
      // Notifications (would come from user preferences table)
      email_notifications: req.user.email_notifications ?? true,
      push_notifications: req.user.push_notifications ?? true,
      sms_notifications: req.user.sms_notifications ?? false,
      marketing_emails: req.user.marketing_emails ?? true,
      
      // Security
      two_factor_enabled: req.user.two_factor_enabled || false,
      
      // Appearance
      theme: req.user.theme || 'system'
    };
    
    return success(res, settings);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PUT /api/users/settings - Update user settings
router.put('/settings', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    const updatedUser = await userService.updateProfile(req.user.id, req.body);
    return success(res, updatedUser);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/users/stats - Get user statistics for profile
router.get('/stats', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    // Mock stats for now - in real implementation would query actual data
    const stats = {
      companies: 1, // Count from company_members table
      apps_installed: 2, // Count from app_installations
      team_members: 3, // Count from company_members where user is admin
      storage_used: 1.2 // GB used across all companies
    };
    
    return success(res, stats);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as userRoutes };