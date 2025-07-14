import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { AuthService } from '@/services/auth.service';
import { authRateLimit } from '@/utils/security';
import { z } from 'zod';

const router = Router();
const authService = new AuthService();

// Apply rate limiting to password reset endpoints
router.use(authRateLimit);

// =====================================================
// PASSWORD RESET REQUEST
// =====================================================

const resetRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  recaptcha_token: z.string().optional() // For bot protection
});

router.post('/request', safeAsync(async (req: any, res: any) => {
  try {
    const { email, recaptcha_token } = resetRequestSchema.parse(req.body);
    
    // Get client info for security logging
    const clientInfo = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      timestamp: new Date().toISOString()
    };
    
    const result = await authService.requestPasswordReset(email, clientInfo);
    
    // Always return success to prevent email enumeration
    return success(res, {
      message: 'If an account with this email exists, you will receive password reset instructions.',
      request_id: result?.request_id
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return error(res, 'Invalid request data', 400);
    }
    return error(res, 'Password reset request failed', 500);
  }
}));

// =====================================================
// PASSWORD RESET VERIFICATION
// =====================================================

const resetVerifySchema = z.object({
  token: z.string().min(32, 'Invalid reset token'),
  new_password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain at least one lowercase, uppercase, and number')
});

router.post('/verify', safeAsync(async (req: any, res: any) => {
  try {
    const { token, new_password } = resetVerifySchema.parse(req.body);
    
    // Get client info for security logging
    const clientInfo = {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      timestamp: new Date().toISOString()
    };
    
    const result = await authService.resetPassword(token, new_password, clientInfo);
    
    return success(res, {
      message: 'Password reset successfully',
      user: result.user,
      token: result.token // New auth token
    });
  } catch (err: any) {
    if (err.name === 'ZodError') {
      return error(res, err.errors[0].message, 400);
    }
    return error(res, err.message || 'Password reset failed', 400);
  }
}));

// =====================================================
// PASSWORD RESET TOKEN VALIDATION
// =====================================================

router.get('/validate/:token', safeAsync(async (req: any, res: any) => {
  try {
    const { token } = req.params;
    
    if (!token || token.length < 32) {
      return error(res, 'Invalid reset token', 400);
    }
    
    const isValid = await authService.validateResetToken(token);
    
    return success(res, {
      valid: isValid,
      message: isValid ? 'Token is valid' : 'Token is invalid or expired'
    });
  } catch (err: any) {
    return error(res, 'Token validation failed', 400);
  }
}));

export { router as passwordResetRoutes };