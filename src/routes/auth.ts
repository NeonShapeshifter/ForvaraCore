import { Router } from 'express';
import { success, error, unauthorized } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { AuthService } from '@/services/auth.service';
import { authenticate } from '@/middleware/auth';
import { AuthRequest } from '@/types/index.js';
import { 
  RegisterUserRequest, 
  LoginRequest, 
  CreateCompanyRequest 
} from '@/types';
import { 
  sanitizeName, 
  sanitizeCompanyName, 
  authRateLimit, 
  registerRateLimit 
} from '@/utils/security';

const router = Router();
const authService = new AuthService();

// =====================================================
// AUTH DUAL: LOGIN
// =====================================================

router.post('/login', authRateLimit, safeAsync(async (req: any, res: any) => {
  const { email, phone, password, identifier } = req.body;
  
  // Support legacy 'identifier' parameter
  const loginData: LoginRequest = {
    email: email || (identifier?.includes('@') ? identifier : undefined),
    phone: phone || (identifier && !identifier.includes('@') ? identifier : undefined),
    password
  };
  
  if (!password) {
    return error(res, 'Password is required', 400);
  }

  if (!loginData.email && !loginData.phone) {
    return error(res, 'Email or phone is required', 400);
  }

  try {
    const result = await authService.login(loginData);
    return success(res, result);
  } catch (err: any) {
    return unauthorized(res, err.message);
  }
}));

// =====================================================
// REGISTER WITH ENTERPRISE FIELDS
// =====================================================

router.post('/register', registerRateLimit, safeAsync(async (req: any, res: any) => {
  const { 
    first_name, 
    last_name, 
    email, 
    phone, 
    password, 
    cedula_panama,
    preferred_language,
    country_code,
    timezone,
    
    // Legacy support
    name, 
    full_name 
  } = req.body;
  
  // Handle legacy 'name' or 'full_name' fields
  let firstName = first_name;
  let lastName = last_name;
  
  if (!firstName && !lastName && (name || full_name)) {
    const fullNameStr = name || full_name;
    const nameParts = fullNameStr.trim().split(' ');
    firstName = nameParts[0];
    lastName = nameParts.slice(1).join(' ') || nameParts[0]; // Fallback if only one name
  }
  
  // Sanitize name inputs
  firstName = sanitizeName(firstName);
  lastName = sanitizeName(lastName);
  
  if (!firstName || !lastName) {
    return error(res, 'First name and last name are required', 400);
  }

  if (!email && !phone) {
    return error(res, 'Email or phone is required', 400);
  }

  if (!password || password.length < 8) {
    return error(res, 'Password must be at least 8 characters', 400);
  }

  try {
    const registerData: RegisterUserRequest = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      password,
      cedula_panama,
      preferred_language: preferred_language || 'es',
      country_code: country_code || 'PA',
      timezone: timezone || 'America/Panama'
    };

    const result = await authService.register(registerData);
    return success(res, result, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// =====================================================
// CREATE COMPANY
// =====================================================

router.post('/create-company', authenticate, safeAsync(async (req: any, res: any) => {
  const {
    razon_social,
    ruc,
    address,
    phone,
    contact_email,
    industry_type,
    company_size,
    billing_email,
    billing_address
  } = req.body;

  if (!razon_social || !ruc) {
    return error(res, 'Company name (razón social) and RUC are required', 400);
  }

  // Sanitize company inputs
  const sanitizedRazonSocial = sanitizeCompanyName(razon_social);
  const sanitizedRuc = ruc.trim().replace(/[^0-9\-]/g, ''); // Only numbers and hyphens for RUC

  if (!sanitizedRazonSocial || !sanitizedRuc) {
    return error(res, 'Invalid company name or RUC format', 400);
  }

  try {
    const companyData: CreateCompanyRequest = {
      razon_social: sanitizedRazonSocial,
      ruc: sanitizedRuc,
      address,
      phone,
      contact_email,
      industry_type,
      company_size,
      billing_email,
      billing_address
    };

    const company = await authService.createCompany(req.user.id, companyData);
    return success(res, company, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// =====================================================
// USER PROFILE (ENTERPRISE RESPONSE)
// =====================================================

router.get('/me', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    // Return enterprise user profile
    const userData = {
      // Core identity
      id: req.user.id,
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      email: req.user.email,
      phone: req.user.phone,
      
      // Legacy compatibility
      name: `${req.user.first_name} ${req.user.last_name}`,
      full_name: `${req.user.first_name} ${req.user.last_name}`,
      
      // Panama specific
      cedula_panama: req.user.cedula_panama,
      tax_id_type: req.user.tax_id_type,
      
      // Auth status
      email_verified: req.user.email_verified,
      phone_verified: req.user.phone_verified,
      auth_method: req.user.auth_method,
      
      // Localization
      preferred_language: req.user.preferred_language,
      timezone: req.user.timezone,
      currency_code: req.user.currency_code,
      country_code: req.user.country_code,
      
      // Profile
      avatar_url: req.user.avatar_url,
      settings: req.user.settings,
      
      // Tracking
      last_login_at: req.user.last_login_at,
      last_ip_address: req.user.last_ip_address,
      
      // Timestamps
      created_at: req.user.created_at,
      updated_at: req.user.updated_at,
      
      // Legacy fields for frontend compatibility
      status: 'active' // No hay status en nuevo schema, default active
    };
    
    return success(res, userData);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// =====================================================
// UPDATE USER PROFILE
// =====================================================

router.patch('/me', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    const updateData = {
      first_name: req.body.first_name,
      last_name: req.body.last_name,
      email: req.body.email,
      phone: req.body.phone,
      cedula_panama: req.body.cedula_panama,
      avatar_url: req.body.avatar_url,
      preferred_language: req.body.preferred_language,
      timezone: req.body.timezone
    };

    // Remove undefined values
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    // Sanitize inputs
    if (updateData.first_name) updateData.first_name = sanitizeName(updateData.first_name);
    if (updateData.last_name) updateData.last_name = sanitizeName(updateData.last_name);

    const updatedUser = await authService.updateUserProfile(req.user.id, updateData);
    return success(res, updatedUser);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// =====================================================
// LOGOUT
// =====================================================

router.post('/logout', authenticate, safeAsync(async (req: any, res: any) => {
  try {
    // TODO: Marcar sesión como terminada en user_sessions
    // For JWT, logout is handled client-side by removing the token
    return success(res, { message: 'Logged out successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// =====================================================
// VERIFICATION ENDPOINTS (TODO: Implementar en producción)
// =====================================================

router.post('/verify-email', safeAsync(async (req: any, res: any) => {
  // TODO: Implementar verificación de email
  return success(res, { message: 'Email verification not implemented yet' });
}));

router.post('/verify-phone', safeAsync(async (req: any, res: any) => {
  // TODO: Implementar verificación de SMS
  return success(res, { message: 'Phone verification not implemented yet' });
}));

router.post('/resend-verification', safeAsync(async (req: any, res: any) => {
  // TODO: Reenviar código de verificación
  return success(res, { message: 'Resend verification not implemented yet' });
}));

// PATCH /api/auth/password - Change user password (alias for /users/change-password)
router.patch('/password', authenticate, safeAsync(async (req: AuthRequest, res) => {
  try {
    const authService = new AuthService();
    await authService.changePassword(req.user!.id, req.body);
    return success(res, { message: 'Password changed successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', safeAsync(async (req: any, res: any) => {
  const { email, phone } = req.body;
  
  try {
    if (!email && !phone) {
      return error(res, 'Email or phone is required', 400);
    }
    
    const authService = new AuthService();
    await authService.requestPasswordReset({ email, phone });
    
    return success(res, { 
      message: 'Si existe una cuenta con esa información, recibirás un enlace para restablecer tu contraseña.' 
    });
  } catch (err: any) {
    // Always return success message for security (don't reveal if email exists)
    return success(res, { 
      message: 'Si existe una cuenta con esa información, recibirás un enlace para restablecer tu contraseña.' 
    });
  }
}));

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', safeAsync(async (req: any, res: any) => {
  const { token, new_password } = req.body;
  
  try {
    if (!token || !new_password) {
      return error(res, 'Token and new password are required', 400);
    }
    
    if (new_password.length < 8) {
      return error(res, 'Password must be at least 8 characters long', 400);
    }
    
    const authService = new AuthService();
    await authService.resetPassword(token, new_password);
    
    return success(res, { message: 'Password reset successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as authRoutes };