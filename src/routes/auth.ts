import { Router } from 'express';
import { success, error, unauthorized } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { AuthService } from '@/services/auth.service';
import { authenticate } from '@/middleware/auth';

const router = Router();
const authService = new AuthService();

router.post('/login', safeAsync(async (req: any, res: any) => {
  const { email, identifier, password } = req.body;
  
  // Support both 'email' and 'identifier' parameters for frontend compatibility
  const loginIdentifier = email || identifier;
  
  if (!loginIdentifier || !password) {
    return error(res, 'Email and password are required', 400);
  }

  try {
    const result = await authService.login(loginIdentifier, password);
    return success(res, result);
  } catch (err: any) {
    return unauthorized(res, err.message);
  }
}));

router.post('/register', safeAsync(async (req: any, res: any) => {
  const { email, phone, password, name, full_name, company_name } = req.body;
  
  // Support both 'name' and 'full_name' for frontend compatibility
  const userName = name || full_name;
  
  if (!password || !userName) {
    return error(res, 'Password and name are required', 400);
  }

  if (!email) {
    return error(res, 'Email is required', 400);
  }

  try {
    const result = await authService.register({
      email,
      phone,
      password,
      name: userName,
      company_name
    });
    return success(res, result, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

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

router.post('/logout', authenticate, safeAsync(async (req: any, res: any) => {
  // For JWT, logout is handled client-side by removing the token
  // In the future, we could implement a token blacklist
  return success(res, { message: 'Logged out successfully' });
}));

export { router as authRoutes };