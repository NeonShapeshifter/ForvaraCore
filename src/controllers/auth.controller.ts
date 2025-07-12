import { Response } from 'express';
// Removed unused imports
import { AuthenticatedRequest } from '../types';
import { authService } from '../services/auth.service';
import { userService } from '../services/user.service';
import { emailService } from '../services/email.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { generateToken, generateRefreshToken } from '../utils/jwt';
import { logger } from '../config/logger';
// Removed unused ErrorCode import
import { ACTIVITY_ACTIONS } from '../constants';
import { 
  ValidationError, 
  AuthenticationError, 
  ConflictError,
  NotFoundError 
} from '../types';

export const register = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { 
      nombre, 
      apellido, 
      telefono, 
      email, 
      password, 
      terms_accepted,
      marketing_consent 
    } = req.body;

    // Verificar si el teléfono ya existe
    const existingUser = await userService.findByPhone(telefono);
    if (existingUser) {
      throw new ConflictError('El teléfono ya está registrado');
    }

    // Verificar email si se proporcionó
    if (email) {
      const existingEmail = await userService.findByEmail(email);
      if (existingEmail) {
        throw new ConflictError('El email ya está registrado');
      }
    }

    // Crear usuario
    const user = await authService.registerUser({
      nombre,
      apellido,
      telefono,
      email,
      password,
      settings: {
        theme: 'light',
        language: 'es',
        timezone: 'America/Panama',
        notifications: {
          email: true,
          push: true,
          sms: false,
          marketing: marketing_consent || false
        }
      }
    });

    // Crear sesión
    const { token, refreshToken, session } = await authService.createSession(
      user.id,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        deviceInfo: req.body.device_info
      }
    );

    // Enviar email de bienvenida si hay email
    if (user.email) {
      await emailService.sendWelcomeEmail(user);
    }

    // Log actividad
    await activityService.log({
      user_id: user.id,
      action: ACTIVITY_ACTIONS.REGISTER_SUCCESS,
      details: {
        method: 'phone',
        has_email: !!email,
        marketing_consent
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    logger.info({
      userId: user.id,
      method: 'phone',
      requestId: req.requestId
    }, 'User registered successfully');

    res.status(201).json(createApiResponse(
      true,
      {
        user: {
          id: user.id,
          nombre: user.nombre,
          apellido: user.apellido,
          telefono: user.telefono,
          email: user.email,
          forvara_mail: user.forvara_mail,
          avatar_url: user.avatar_url,
          created_at: user.created_at
        },
        auth: {
          token,
          refreshToken,
          expiresIn: 604800, // 7 días
          tokenType: 'Bearer'
        },
        session: {
          id: session.id,
          device: session.device_info,
          created_at: session.created_at
        }
      },
      'Usuario registrado exitosamente',
      'Bienvenido a Forvara'
    ));
  } catch (error: any) {
    // Log actividad de fallo
    if (req.body?.telefono) {
      await activityService.log({
        action: ACTIVITY_ACTIONS.REGISTER_FAILED,
        details: {
          reason: error.message,
          phone: req.body.telefono.slice(0, 3) + '****'
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        success: false,
        error_message: error.message
      });
    }

    throw error;
  }
};

export const login = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { identifier, password, remember_me, device_info } = req.body;

    // Buscar usuario por teléfono, email o forvara_mail
    const user = await userService.findByIdentifier(identifier);
    
    if (!user) {
      // Log intento fallido
      await activityService.log({
        action: ACTIVITY_ACTIONS.LOGIN_FAILED,
        details: {
          identifier: identifier.includes('@') ? 'email' : 'phone',
          reason: 'user_not_found'
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        success: false,
        error_message: 'Usuario no encontrado'
      });

      throw new AuthenticationError('Credenciales inválidas');
    }

    // Verificar contraseña
    const isValidPassword = await authService.verifyPassword(
      password,
      user.password_hash
    );

    if (!isValidPassword) {
      // Log intento fallido
      await activityService.log({
        user_id: user.id,
        action: ACTIVITY_ACTIONS.LOGIN_FAILED,
        details: {
          reason: 'invalid_password'
        },
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        success: false,
        error_message: 'Contraseña incorrecta'
      });

      throw new AuthenticationError('Credenciales inválidas');
    }

    // Verificar si el usuario está activo
    if (!user.activo) {
      throw new AuthenticationError('Tu cuenta está desactivada');
    }

    // Detectar cambio sospechoso de ubicación
    const lastSession = await authService.getLastSession(user.id);
    if (lastSession && req.ip !== lastSession.ip_address) {
      // Aquí podrías implementar verificación adicional
      logger.warn({
        userId: user.id,
        oldIp: lastSession.ip_address,
        newIp: req.ip
      }, 'Login from different IP detected');
    }

    // Crear sesión
    const sessionDuration = remember_me ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const { token, refreshToken, session } = await authService.createSession(
      user.id,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        deviceInfo: device_info || {}
      },
      sessionDuration
    );

    // Obtener tenants del usuario
    const tenants = await userService.getUserTenants(user.id);

    // Log actividad exitosa
    await activityService.log({
      user_id: user.id,
      action: ACTIVITY_ACTIONS.LOGIN_SUCCESS,
      details: {
        method: identifier.includes('@') ? 'email' : 'phone',
        remember_me,
        device: device_info?.platform
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    logger.info({
      userId: user.id,
      sessionId: session.id,
      requestId: req.requestId
    }, 'User logged in successfully');

    res.json(createApiResponse(
      true,
      {
        user: {
          id: user.id,
          nombre: user.nombre,
          apellido: user.apellido,
          telefono: user.telefono,
          email: user.email,
          forvara_mail: user.forvara_mail,
          avatar_url: user.avatar_url,
          settings: user.settings
        },
        auth: {
          token,
          refreshToken,
          expiresIn: sessionDuration / 1000,
          tokenType: 'Bearer'
        },
        session: {
          id: session.id,
          device: session.device_info,
          created_at: session.created_at
        },
        tenants: tenants.map(t => ({
          id: t.tenant.id,
          nombre: t.tenant.nombre,
          logo_url: t.tenant.logo_url,
          rol: t.rol,
          is_owner: t.tenant.created_by === user.id
        }))
      },
      'Login exitoso',
      'Bienvenido de vuelta'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const logout = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const token = req.headers.authorization?.substring(7);
    
    if (token && req.userId) {
      await authService.invalidateSession(token);
      
      // Log actividad
      await activityService.log({
        user_id: req.userId,
        action: ACTIVITY_ACTIONS.LOGOUT,
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
        success: true
      });
    }

    res.json(createApiResponse(
      true,
      null,
      'Sesión cerrada exitosamente'
    ));
  } catch (error: any) {
    // No fallar si hay error al cerrar sesión
    logger.error({
      error: error.message,
      userId: req.userId,
      requestId: req.requestId
    }, 'Error during logout');

    res.json(createApiResponse(
      true,
      null,
      'Sesión cerrada'
    ));
  }
};

export const refreshToken = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { refresh_token } = req.body;
    const currentToken = req.headers.authorization?.substring(7);

    const result = await authService.refreshSession(
      refresh_token,
      currentToken
    );

    res.json(createApiResponse(
      true,
      {
        auth: {
          token: result.token,
          refreshToken: result.refreshToken,
          expiresIn: 604800,
          tokenType: 'Bearer'
        }
      },
      'Token renovado exitosamente'
    ));
  } catch (error: any) {
    throw new AuthenticationError('Token de renovación inválido');
  }
};

export const selectTenant = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { tenantId } = req.body;
    const userId = req.userId!;

    // Verificar que el usuario tiene acceso al tenant
    const userTenant = await userService.getUserTenantAccess(userId, tenantId);
    
    if (!userTenant || !userTenant.activo) {
      throw new AuthorizationError('No tienes acceso a esta empresa');
    }

    // Generar nuevo token con tenantId
    const token = generateToken(userId, tenantId);
    const refreshToken = generateRefreshToken(userId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: ACTIVITY_ACTIONS.TENANT_SELECTED,
      details: {
        tenant_name: userTenant.tenant.nombre,
        user_role: userTenant.rol
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      {
        tenant: {
          id: userTenant.tenant.id,
          nombre: userTenant.tenant.nombre,
          logo_url: userTenant.tenant.logo_url,
          rol: userTenant.rol
        },
        auth: {
          token,
          refreshToken,
          expiresIn: 604800,
          tokenType: 'Bearer'
        }
      },
      'Empresa seleccionada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const forgotPassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { identifier } = req.body;

    // Buscar usuario
    const user = await userService.findByIdentifier(identifier);
    
    if (!user) {
      // No revelar si el usuario existe o no
      res.json(createApiResponse(
        true,
        null,
        'Si el usuario existe, recibirás un email con instrucciones'
      ));
      return;
    }

    // Generar token de reseteo
    const resetToken = await authService.generatePasswordResetToken(user.id);

    // Enviar email
    if (user.email) {
      await emailService.sendPasswordResetEmail(user, resetToken);
    } else {
      // Si no tiene email, enviar SMS
      // TODO: Implementar envío de SMS
      logger.warn({
        userId: user.id,
        phone: user.telefono
      }, 'User has no email for password reset');
    }

    // Log actividad
    await activityService.log({
      user_id: user.id,
      action: ACTIVITY_ACTIONS.PASSWORD_RESET,
      details: {
        method: user.email ? 'email' : 'sms'
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Si el usuario existe, recibirás un email con instrucciones'
    ));
  } catch (error: any) {
    logger.error({
      error: error.message,
      requestId: req.requestId
    }, 'Forgot password error');

    // No revelar errores específicos
    res.json(createApiResponse(
      true,
      null,
      'Si el usuario existe, recibirás un email con instrucciones'
    ));
  }
};

export const resetPassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { token, password } = req.body;

    // Verificar y usar token
    const userId = await authService.verifyPasswordResetToken(token);

    // Actualizar contraseña
    await authService.updatePassword(userId, password);

    // Invalidar todas las sesiones del usuario
    await authService.invalidateAllUserSessions(userId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.PASSWORD_CHANGED,
      details: {
        method: 'reset_token'
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Contraseña actualizada exitosamente',
      'Por favor inicia sesión con tu nueva contraseña'
    ));
  } catch (error: any) {
    throw new ValidationError('Token inválido o expirado');
  }
};

export const changePassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { current_password, new_password, logout_other_sessions } = req.body;
    const userId = req.userId!;

    // Obtener usuario
    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    // Verificar contraseña actual
    const isValid = await authService.verifyPassword(
      current_password,
      user.password_hash
    );

    if (!isValid) {
      throw new ValidationError('Contraseña actual incorrecta');
    }

    // Actualizar contraseña
    await authService.updatePassword(userId, new_password);

    // Cerrar otras sesiones si se solicita
    if (logout_other_sessions) {
      const currentToken = req.headers.authorization?.substring(7);
      await authService.invalidateAllUserSessionsExcept(userId, currentToken!);
    }

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.PASSWORD_CHANGED,
      details: {
        method: 'user_change',
        logout_others: logout_other_sessions
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Contraseña actualizada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSessions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const currentToken = req.headers.authorization?.substring(7);

    const sessions = await authService.getUserSessions(userId);

    const formattedSessions = sessions.map(session => ({
      id: session.id,
      device: session.device_info,
      ip_address: session.ip_address,
      last_activity: session.last_activity,
      created_at: session.created_at,
      is_current: session.token_hash === authService.hashToken(currentToken!)
    }));

    res.json(createApiResponse(
      true,
      formattedSessions,
      'Sesiones activas obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const terminateSession = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const userId = req.userId!;

    await authService.terminateSession(userId, sessionId);

    // Log actividad
    await activityService.log({
      user_id: userId,
      action: ACTIVITY_ACTIONS.SESSION_TERMINATED,
      details: {
        terminated_session_id: sessionId
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    res.json(createApiResponse(
      true,
      null,
      'Sesión terminada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const verifyEmail = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { token } = req.body;

    const userId = await authService.verifyEmailToken(token);
    await userService.markEmailAsVerified(userId);

    res.json(createApiResponse(
      true,
      null,
      'Email verificado exitosamente'
    ));
  } catch (error: any) {
    throw new ValidationError('Token inválido o expirado');
  }
};

export const resendVerification = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const user = await userService.findById(userId);

    if (!user || !user.email) {
      throw new ValidationError('No hay email para verificar');
    }

    if (user.email_verified) {
      throw new ValidationError('El email ya está verificado');
    }

    const token = await authService.generateEmailVerificationToken(userId);
    await emailService.sendVerificationEmail(user, token);

    res.json(createApiResponse(
      true,
      null,
      'Email de verificación enviado'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const enable2FA = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { password } = req.body;
    const userId = req.userId!;

    // Verificar contraseña
    const user = await userService.findById(userId);
    if (!user) {
      throw new NotFoundError('Usuario');
    }

    const isValid = await authService.verifyPassword(password, user.password_hash);
    if (!isValid) {
      throw new ValidationError('Contraseña incorrecta');
    }

    // Generar secreto 2FA
    const { secret, qrCode, backupCodes } = await authService.setup2FA(userId);

    res.json(createApiResponse(
      true,
      {
        secret,
        qrCode,
        backupCodes
      },
      'Configuración 2FA generada',
      'Escanea el código QR con tu app de autenticación'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const verify2FA = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { code } = req.body;
    const userId = req.userId!;

    const isValid = await authService.verify2FACode(userId, code);

    if (!isValid) {
      throw new ValidationError('Código inválido');
    }

    // Activar 2FA si es la primera vez
    await authService.enable2FA(userId);

    res.json(createApiResponse(
      true,
      null,
      'Código verificado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};
