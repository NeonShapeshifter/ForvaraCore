import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis, SessionStore } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';
import { 
  AuthenticationError, 
  ValidationError,
  NotFoundError,
  ConflictError,
  ForvaraUser,
  LoginResponse,
  RefreshTokenResponse
} from '../types';
import { generateToken, generateRefreshToken, verifyToken } from '../utils/jwt';
import { generateCode } from '../utils/helpers';
import { emailQueue } from '../queues';

const sessionStore = new SessionStore();

class AuthService {
  private getSupabase() {
    return getSupabase();
  }

  /**
   * Registrar nuevo usuario
   */
  async registerUser(data: {
    nombre: string;
    apellido: string;
    telefono: string;
    email?: string;
    password: string;
    settings?: any;
  }): Promise<{ user: ForvaraUser; token: string }> {
    try {
      // Validar si ya existe usuario con ese teléfono
      const { data: existingPhone } = await this.getSupabase()
        .from('users')
        .select('id')
        .eq('telefono', data.telefono)
        .single();

      if (existingPhone) {
        throw new ConflictError('Ya existe un usuario con ese teléfono');
      }

      // Validar email si se proporciona
      if (data.email) {
        const { data: existingEmail } = await this.getSupabase()
          .from('users')
          .select('id')
          .eq('email', data.email)
          .single();

        if (existingEmail) {
          throw new ConflictError('Ya existe un usuario con ese email');
        }
      }

      // Generar forvara_mail único
      const forvaraMail = await this.generateUniqueForvaraMail(data.nombre, data.apellido);

      // Hash password
      const hashedPassword = await bcrypt.hash(data.password, 10);

      // Crear usuario en Supabase Auth
      const { data: authUser, error: authError } = await this.getSupabase().auth.admin.createUser({
        email: data.email || `${forvaraMail}@forvara.com`,
        password: data.password,
        email_confirm: true,
        phone: data.telefono,
        user_metadata: {
          nombre: data.nombre,
          apellido: data.apellido
        }
      });

      if (authError) {
        logger.error({ error: authError }, 'Error creating auth user');
        throw new Error('Error al crear usuario');
      }

      // Crear perfil de usuario
      const { data: user, error: profileError } = await this.getSupabase()
        .from('users')
        .insert({
          id: authUser.user.id,
          nombre: data.nombre,
          apellido: data.apellido,
          telefono: data.telefono,
          email: data.email,
          forvara_mail: forvaraMail,
          password_hash: hashedPassword,
          settings: data.settings || {},
          is_active: true,
          email_verified: false,
          phone_verified: false
        })
        .select()
        .single();

      if (profileError) {
        // Rollback: eliminar usuario de auth
        await this.getSupabase().auth.admin.deleteUser(authUser.user.id);
        throw profileError;
      }

      // Crear sesión
      const token = await this.createSession(user.id, {
        email: user.email,
        forvara_mail: user.forvara_mail
      });

      // Enviar email de bienvenida
      if (user.email) {
        await emailQueue.add({
          to: user.email,
          subject: 'Bienvenido a Forvara',
          template: 'welcome',
          data: {
            name: user.nombre,
            forvaraMail: user.forvara_mail
          }
        });
      }

      // Enviar código de verificación por SMS
      await this.sendPhoneVerification(user.telefono);

      logger.info({ userId: user.id, forvaraMail }, 'User registered successfully');

      return { user, token };
    } catch (error) {
      logger.error({ error }, 'Registration failed');
      throw error;
    }
  }

  /**
   * Login de usuario
   */
  async login(credentials: {
    username: string; // email, teléfono o forvara_mail
    password: string;
    deviceInfo?: {
      userAgent?: string;
      ip?: string;
      deviceId?: string;
    };
  }): Promise<LoginResponse> {
    try {
      // Buscar usuario por email, teléfono o forvara_mail
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('*')
        .or(`email.eq.${credentials.username},telefono.eq.${credentials.username},forvara_mail.eq.${credentials.username}`)
        .single();

      if (!user) {
        throw new AuthenticationError('Credenciales inválidas');
      }

      // Verificar si el usuario está activo
      if (!user.is_active) {
        throw new AuthenticationError('Usuario inactivo');
      }

      // Verificar contraseña
      const validPassword = await bcrypt.compare(credentials.password, user.password_hash);
      if (!validPassword) {
        // Registrar intento fallido
        await this.recordFailedLogin(user.id, credentials.deviceInfo);
        throw new AuthenticationError('Credenciales inválidas');
      }

      // Verificar si requiere 2FA
      if (user.two_factor_enabled) {
        // Generar código temporal
        const tempToken = await this.generateTempToken(user.id);
        return {
          requiresTwoFactor: true,
          tempToken,
          user: null,
          token: null,
          refreshToken: null
        };
      }

      // Crear sesión
      const sessionData = {
        email: user.email,
        forvara_mail: user.forvara_mail,
        device: credentials.deviceInfo
      };

      const token = await this.createSession(user.id, sessionData);
      const refreshToken = await generateRefreshToken(user.id);

      // Actualizar último login
      await this.getSupabase()
        .from('users')
        .update({
          last_login: new Date().toISOString(),
          last_ip: credentials.deviceInfo?.ip
        })
        .eq('id', user.id);

      // Obtener tenants del usuario
      const { data: userTenants } = await this.getSupabase()
        .from('user_tenants')
        .select(`
          tenant_id,
          rol,
          permisos,
          tenants (*)
        `)
        .eq('usuario_id', user.id)
        .eq('activo', true);

      logger.info({ 
        userId: user.id, 
        method: credentials.username.includes('@') ? 'email' : 'phone' 
      }, 'User logged in');

      return {
        requiresTwoFactor: false,
        user: {
          ...user,
          tenants: userTenants || []
        },
        token,
        refreshToken
      };
    } catch (error) {
      logger.error({ error }, 'Login failed');
      throw error;
    }
  }

  /**
   * Verificar 2FA
   */
  async verifyTwoFactor(tempToken: string, code: string): Promise<LoginResponse> {
    try {
      // Verificar temp token
      const payload = await verifyToken(tempToken);
      if (!payload || !payload.temp) {
        throw new AuthenticationError('Token temporal inválido');
      }

      // Obtener usuario
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('*')
        .eq('id', payload.userId)
        .single();

      if (!user) {
        throw new NotFoundError('Usuario');
      }

      // Verificar código 2FA
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: code,
        window: 2
      });

      if (!verified) {
        throw new AuthenticationError('Código 2FA inválido');
      }

      // Crear sesión real
      const token = await this.createSession(user.id, {
        email: user.email,
        forvara_mail: user.forvara_mail,
        twoFactorVerified: true
      });

      const refreshToken = await generateRefreshToken(user.id);

      // Actualizar último login
      await this.getSupabase()
        .from('users')
        .update({
          last_login: new Date().toISOString()
        })
        .eq('id', user.id);

      return {
        requiresTwoFactor: false,
        user,
        token,
        refreshToken
      };
    } catch (error) {
      logger.error({ error }, '2FA verification failed');
      throw error;
    }
  }

  /**
   * Cerrar sesión
   */
  async logout(token: string): Promise<void> {
    try {
      await sessionStore.delete(token);
      logger.info('User logged out');
    } catch (error) {
      logger.error({ error }, 'Logout failed');
      throw error;
    }
  }

  /**
   * Cerrar todas las sesiones
   */
  async logoutAllDevices(userId: string): Promise<void> {
    try {
      await sessionStore.deleteAllUserSessions(userId);
      logger.info({ userId }, 'All sessions terminated');
    } catch (error) {
      logger.error({ error }, 'Logout all devices failed');
      throw error;
    }
  }

  /**
   * Refrescar token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    try {
      const payload = await verifyToken(refreshToken);
      if (!payload || !payload.refresh) {
        throw new AuthenticationError('Refresh token inválido');
      }

      // Verificar si el usuario existe y está activo
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('id, is_active')
        .eq('id', payload.userId)
        .single();

      if (!user || !user.is_active) {
        throw new AuthenticationError('Usuario no válido');
      }

      // Generar nuevos tokens
      const newToken = await generateToken(user.id);
      const newRefreshToken = await generateRefreshToken(user.id);

      return {
        token: newToken,
        refreshToken: newRefreshToken
      };
    } catch (error) {
      logger.error({ error }, 'Token refresh failed');
      throw error;
    }
  }

  /**
   * Solicitar restablecimiento de contraseña
   */
  async requestPasswordReset(email: string): Promise<void> {
    try {
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('id, nombre, email')
        .eq('email', email)
        .single();

      if (!user) {
        // No revelar si el email existe o no
        logger.warn({ email }, 'Password reset requested for non-existent email');
        return;
      }

      // Generar token de reset
      const resetToken = await this.generatePasswordResetToken(user.id);

      // Enviar email
      await emailQueue.add({
        to: user.email!,
        subject: 'Restablecer contraseña - Forvara',
        template: 'password-reset',
        data: {
          name: user.nombre,
          resetLink: `${config.FRONTEND_URL}/reset-password?token=${resetToken}`
        }
      });

      logger.info({ userId: user.id }, 'Password reset email sent');
    } catch (error) {
      logger.error({ error }, 'Password reset request failed');
      throw error;
    }
  }

  /**
   * Restablecer contraseña
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const payload = await verifyToken(token);
      if (!payload || !payload.reset) {
        throw new AuthenticationError('Token de reset inválido');
      }

      // Hash nueva contraseña
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      // Actualizar contraseña
      const { error } = await this.getSupabase()
        .from('users')
        .update({
          password_hash: hashedPassword,
          password_changed_at: new Date().toISOString()
        })
        .eq('id', payload.userId);

      if (error) throw error;

      // Invalidar todas las sesiones
      await this.logoutAllDevices(payload.userId);

      // Actualizar en Supabase Auth
      await this.getSupabase().auth.admin.updateUserById(payload.userId, {
        password: newPassword
      });

      logger.info({ userId: payload.userId }, 'Password reset successfully');
    } catch (error) {
      logger.error({ error }, 'Password reset failed');
      throw error;
    }
  }

  /**
   * Habilitar 2FA
   */
  async enableTwoFactor(userId: string): Promise<{ secret: string; qrCode: string }> {
    try {
      // Generar secret
      const secret = speakeasy.generateSecret({
        name: 'Forvara',
        issuer: 'Forvara'
      });

      // Guardar secret temporalmente
      await this.getSupabase()
        .from('users')
        .update({
          two_factor_temp_secret: secret.base32
        })
        .eq('id', userId);

      // Generar QR code
      const qrCode = await QRCode.toDataURL(secret.otpauth_url!);

      return {
        secret: secret.base32,
        qrCode
      };
    } catch (error) {
      logger.error({ error }, 'Enable 2FA failed');
      throw error;
    }
  }

  /**
   * Confirmar 2FA
   */
  async confirmTwoFactor(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    try {
      // Obtener usuario
      const { data: user } = await this.getSupabase()
        .from('users')
        .select('two_factor_temp_secret')
        .eq('id', userId)
        .single();

      if (!user || !user.two_factor_temp_secret) {
        throw new ValidationError('No hay configuración 2FA pendiente');
      }

      // Verificar código
      const verified = speakeasy.totp.verify({
        secret: user.two_factor_temp_secret,
        encoding: 'base32',
        token: code,
        window: 2
      });

      if (!verified) {
        throw new ValidationError('Código inválido');
      }

      // Generar códigos de respaldo
      const backupCodes = Array.from({ length: 8 }, () => generateCode(8));

      // Activar 2FA
      await this.getSupabase()
        .from('users')
        .update({
          two_factor_enabled: true,
          two_factor_secret: user.two_factor_temp_secret,
          two_factor_temp_secret: null,
          two_factor_backup_codes: backupCodes.map(code => 
            crypto.createHash('sha256').update(code).digest('hex')
          )
        })
        .eq('id', userId);

      logger.info({ userId }, '2FA enabled');

      return { backupCodes };
    } catch (error) {
      logger.error({ error }, 'Confirm 2FA failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async generateUniqueForvaraMail(nombre: string, apellido: string): Promise<string> {
    const baseUsername = `${nombre.toLowerCase()}.${apellido.toLowerCase()}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9.]/g, '');

    let username = baseUsername;
    let counter = 1;

    while (true) {
      const { data: existing } = await this.getSupabase()
        .from('users')
        .select('id')
        .eq('forvara_mail', username)
        .single();

      if (!existing) break;

      username = `${baseUsername}${counter}`;
      counter++;
    }

    return username;
  }

  private async createSession(userId: string, data: any): Promise<string> {
    const token = await generateToken(userId);
    await sessionStore.create(userId, {
      userId,
      ...data,
      createdAt: new Date()
    });
    return token;
  }

  private async generateTempToken(userId: string): Promise<string> {
    return jwt.sign(
      { userId, temp: true },
      config.JWT_SECRET,
      { expiresIn: '5m' }
    );
  }

  private async generatePasswordResetToken(userId: string): Promise<string> {
    return jwt.sign(
      { userId, reset: true },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  private async sendPhoneVerification(phone: string): Promise<void> {
    const code = generateCode(6);
    
    // Guardar código en Redis con TTL de 10 minutos
    const redis = getRedis();
    await redis.setex(`phone_verify:${phone}`, 600, code);

    // Aquí integrarías con tu servicio de SMS
    logger.info({ phone, code }, 'Phone verification code sent');
  }

  private async recordFailedLogin(userId: string, deviceInfo?: any): Promise<void> {
    const redis = getRedis();
    const key = `failed_login:${userId}`;
    
    await redis.incr(key);
    await redis.expire(key, 3600); // 1 hora

    // Si hay más de 5 intentos, bloquear temporalmente
    const attempts = await redis.get(key);
    if (parseInt(attempts || '0') > 5) {
      await this.getSupabase()
        .from('users')
        .update({ 
          is_active: false,
          locked_until: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutos
        })
        .eq('id', userId);
    }
  }
}

export const authService = new AuthService();
