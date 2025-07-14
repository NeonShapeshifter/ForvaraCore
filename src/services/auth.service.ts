import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';
import { EmailService } from './email.service.js';
import { 
  User, 
  Company, 
  CompanyMember, 
  RegisterUserRequest, 
  LoginRequest, 
  CreateCompanyRequest,
  JWTPayload,
  UserSession
} from '@/types';

export class AuthService {
  private emailService = new EmailService();
  
  // =====================================================
  // DUAL AUTH: EMAIL OR PHONE LOGIN
  // =====================================================
  
  async login(loginData: LoginRequest) {
    try {
      const { email, phone, password } = loginData;

      if (!password) {
        throw new Error('Password is required');
      }

      if (!email && !phone) {
        throw new Error('Email or phone is required');
      }

      // Buscar usuario por email o teléfono
      let query = supabase
        .from('users')
        .select('*');

      // Ajustar query según el tipo de login
      if (email) {
        query = query.eq('email', email.toLowerCase());
      } else if (phone) {
        query = query.eq('phone', phone.trim());
      }

      const { data: user } = await safeSupabaseQuery(
        query.single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Verificar que el método de auth sea compatible
      const authMethod = user.auth_method;
      if (email && authMethod === 'phone') {
        throw new Error('This account only supports phone login');
      }
      if (phone && authMethod === 'email') {
        throw new Error('This account only supports email login');
      }

      // Verificar password
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      // Verificar verificación de email/phone
      if (email && !user.email_verified) {
        throw new Error('Please verify your email first');
      }
      if (phone && !user.phone_verified) {
        throw new Error('Please verify your phone first');
      }

      // Obtener companies del usuario
      const companies = await this.getUserCompanies(user.id);

      // Actualizar last_login_at y last_ip_address
      await supabase
        .from('users')
        .update({ 
          last_login_at: new Date().toISOString(),
          // TODO: Obtener IP real del request
        })
        .eq('id', user.id);

      // Crear sesión de usuario
      const session = await this.createUserSession(user.id, companies[0]?.id);

      // Generar JWT token
      const token = this.generateJWT({
        userId: user.id,
        email: user.email,
        phone: user.phone,
        companyId: companies[0]?.id,
        role: companies[0]?.user_role
      });

      return {
        user: this.formatUserResponse(user),
        token,
        companies,
        session_id: session.session_id
      };

    } catch (error: any) {
      console.error('❌ Login error:', error);
      throw new Error(error.message || 'Login failed');
    }
  }

  // =====================================================
  // REGISTER WITH DUAL AUTH SUPPORT
  // =====================================================

  async register(data: RegisterUserRequest) {
    try {
      const { 
        first_name, 
        last_name, 
        email, 
        phone, 
        password, 
        cedula_panama,
        preferred_language = 'es',
        country_code = 'PA',
        timezone = 'America/Panama'
      } = data;

      // Validaciones básicas
      if (!first_name || !last_name) {
        throw new Error('First name and last name are required');
      }

      if (!email && !phone) {
        throw new Error('Email or phone is required');
      }

      if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      // Determinar método de auth
      let auth_method: 'email' | 'phone' | 'both' = 'email';
      if (email && phone) auth_method = 'both';
      else if (phone) auth_method = 'phone';

      // Verificar si el usuario ya existe
      if (email) {
        const { data: existingEmail } = await safeSupabaseQuery(
          supabase
            .from('users')
            .select('id')
            .eq('email', email.toLowerCase())
            .single(),
          { data: null, error: null }
        );

        if (existingEmail) {
          throw new Error('Email already registered');
        }
      }

      if (phone) {
        const { data: existingPhone } = await safeSupabaseQuery(
          supabase
            .from('users')
            .select('id')
            .eq('phone', phone.trim())
            .single(),
          { data: null, error: null }
        );

        if (existingPhone) {
          throw new Error('Phone already registered');
        }
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Crear usuario
      const { data: user, error } = await supabase
        .from('users')
        .insert({
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          email: email?.toLowerCase() || null,
          phone: phone?.trim() || null,
          cedula_panama: cedula_panama?.trim() || null,
          password_hash: passwordHash,
          auth_method,
          preferred_language,
          country_code,
          timezone,
          currency_code: this.getCurrencyByCountry(country_code),
          // Email se verifica automáticamente en desarrollo
          email_verified: process.env.NODE_ENV === 'development' ? true : false,
          phone_verified: process.env.NODE_ENV === 'development' ? true : false,
          settings: {}
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Registration failed: ${error.message}`);
      }

      // TODO: Enviar emails/SMS de verificación en producción
      if (process.env.NODE_ENV === 'production') {
        if (email) await this.sendEmailVerification(user.id, email);
        if (phone) await this.sendPhoneVerification(user.id, phone);
      }

      // Generar JWT token
      const token = this.generateJWT({
        userId: user.id,
        email: user.email,
        phone: user.phone
      });

      return {
        user: this.formatUserResponse(user),
        token,
        message: process.env.NODE_ENV === 'production' 
          ? 'Please verify your email/phone to complete registration'
          : 'Registration successful'
      };

    } catch (error: any) {
      console.error('❌ Register error:', error);
      throw new Error(error.message || 'Registration failed');
    }
  }

  // =====================================================
  // COMPANY CREATION
  // =====================================================

  async createCompany(userId: string, companyData: CreateCompanyRequest) {
    try {
      const {
        razon_social,
        ruc,
        address,
        phone,
        contact_email,
        industry_type,
        company_size = 'pequena',
        billing_email,
        billing_address
      } = companyData;

      if (!razon_social || !ruc) {
        throw new Error('Company name (razón social) and RUC are required');
      }

      // Verificar si RUC ya existe
      const { data: existingRuc } = await safeSupabaseQuery(
        supabase
          .from('companies')
          .select('id')
          .eq('ruc', ruc.trim())
          .single(),
        { data: null, error: null }
      );

      if (existingRuc) {
        throw new Error('RUC already registered');
      }

      // Generar slug único
      const baseSlug = razon_social
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      
      const slug = `${baseSlug}-${Date.now()}`;

      // Crear empresa
      const { data: company, error } = await supabase
        .from('companies')
        .insert({
          razon_social: razon_social.trim(),
          ruc: ruc.trim(),
          address: address?.trim() || null,
          phone: phone?.trim() || null,
          contact_email: contact_email?.trim() || null,
          industry_type,
          company_size,
          slug,
          billing_email: billing_email?.trim() || null,
          billing_address: billing_address?.trim() || null,
          owner_id: userId,
          created_by: userId,
          status: 'trial', // Empresas empiezan en trial
          trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días
          settings: {},
          onboarding_completed: false
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Company creation failed: ${error.message}`);
      }

      // Agregar usuario como owner
      await supabase
        .from('company_members')
        .insert({
          user_id: userId,
          company_id: company.id,
          role: 'owner',
          status: 'active',
          permissions: ['*'] // Owner tiene todos los permisos
        });

      // Log de auditoría
      await this.logActivity({
        company_id: company.id,
        user_id: userId,
        entity_type: 'company',
        entity_id: company.id,
        action: 'create',
        new_values: company
      });

      return company;

    } catch (error: any) {
      console.error('❌ Create company error:', error);
      throw new Error(error.message || 'Company creation failed');
    }
  }

  // =====================================================
  // TOKEN VALIDATION
  // =====================================================

  async validateToken(token: string): Promise<User> {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
      
      // Buscar usuario actualizado
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('*')
          .eq('id', decoded.userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error: any) {
      console.error('❌ Token validation error:', error);
      throw new Error('Invalid token');
    }
  }

  // =====================================================
  // PASSWORD RESET METHODS
  // =====================================================

  async requestPasswordReset(email: string, clientInfo: any) {
    try {
      // Check if user exists (but don't reveal this in response)
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id, email, first_name')
          .eq('email', email)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        // Log security event but return success
        await this.logSecurityEvent('password_reset_attempt_invalid_email', {
          email,
          ...clientInfo
        });
        return { request_id: crypto.randomBytes(16).toString('hex') };
      }

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Store reset token in database
      const { error: insertError } = await supabase
        .from('password_reset_tokens')
        .insert({
          user_id: user.id,
          token: resetToken,
          expires_at: expiresAt.toISOString(),
          client_ip: clientInfo.ip,
          user_agent: clientInfo.userAgent,
          used: false
        });

      if (insertError) {
        throw new Error('Failed to create reset token');
      }

      // Log security event
      await this.logSecurityEvent('password_reset_requested', {
        user_id: user.id,
        email,
        ...clientInfo
      });

      // Send reset email
      await this.emailService.sendPasswordResetEmail(
        email,
        user.first_name,
        resetToken
      );

      return { request_id: resetToken.substring(0, 8) };
    } catch (error: any) {
      console.error('❌ Password reset request error:', error);
      throw new Error('Password reset request failed');
    }
  }

  async resetPassword(token: string, newPassword: string, clientInfo: any) {
    try {
      // Find and validate reset token
      const { data: resetRecord } = await safeSupabaseQuery(
        supabase
          .from('password_reset_tokens')
          .select('*, users(*)')
          .eq('token', token)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .single(),
        { data: null, error: null }
      );

      if (!resetRecord) {
        await this.logSecurityEvent('password_reset_invalid_token', {
          token: token.substring(0, 8) + '...',
          ...clientInfo
        });
        throw new Error('Invalid or expired reset token');
      }

      const user = resetRecord.users;

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // Update password
      const { error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: hashedPassword,
          updated_at: new Date().toISOString()
        })
        .eq('id', user.id);

      if (updateError) {
        throw new Error('Failed to update password');
      }

      // Mark token as used
      await supabase
        .from('password_reset_tokens')
        .update({ used: true, used_at: new Date().toISOString() })
        .eq('token', token);

      // Invalidate all existing sessions for security
      await supabase
        .from('user_sessions')
        .update({ status: 'revoked', ended_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('status', 'active');

      // Log security event
      await this.logSecurityEvent('password_reset_completed', {
        user_id: user.id,
        email: user.email,
        ...clientInfo
      });

      // Create new session and generate token
      const sessionResult = await this.createUserSession(user.id, clientInfo);
      const jwtToken = this.generateJWT({
        userId: user.id,
        email: user.email,
        phone: user.phone
      });

      return {
        user: this.formatUserResponse(user),
        token: jwtToken
      };
    } catch (error: any) {
      console.error('❌ Password reset error:', error);
      throw error;
    }
  }

  async validateResetToken(token: string): Promise<boolean> {
    try {
      const { data: resetRecord } = await safeSupabaseQuery(
        supabase
          .from('password_reset_tokens')
          .select('id')
          .eq('token', token)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .single(),
        { data: null, error: null }
      );

      return !!resetRecord;
    } catch (error) {
      return false;
    }
  }

  // =====================================================
  // EMAIL CHANGE METHODS
  // =====================================================

  async requestEmailChange(userId: string, newEmail: string, currentPassword: string, clientInfo: any) {
    try {
      // Verify current password
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id, email, password_hash')
          .eq('id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      const passwordValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!passwordValid) {
        await this.logSecurityEvent('email_change_invalid_password', {
          user_id: userId,
          old_email: user.email,
          new_email: newEmail,
          ...clientInfo
        });
        throw new Error('Invalid current password');
      }

      // Check if new email is already in use
      const { data: existingUser } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id')
          .eq('email', newEmail)
          .single(),
        { data: null, error: null }
      );

      if (existingUser) {
        throw new Error('Email already in use');
      }

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Store email change request
      const { error: insertError } = await supabase
        .from('email_change_requests')
        .insert({
          user_id: userId,
          old_email: user.email,
          new_email: newEmail,
          token: verificationToken,
          expires_at: expiresAt.toISOString(),
          client_ip: clientInfo.ip,
          user_agent: clientInfo.userAgent,
          verified: false
        });

      if (insertError) {
        throw new Error('Failed to create email change request');
      }

      // Log security event
      await this.logSecurityEvent('email_change_requested', {
        user_id: userId,
        old_email: user.email,
        new_email: newEmail,
        ...clientInfo
      });

      // Send verification email to new address
      await this.emailService.sendEmailChangeVerification(
        newEmail,
        user.email,
        verificationToken
      );

      return {
        message: 'Verification email sent to new address',
        new_email: newEmail
      };
    } catch (error: any) {
      console.error('❌ Email change request error:', error);
      throw error;
    }
  }

  async verifyEmailChange(token: string, clientInfo: any) {
    try {
      // Find and validate email change request
      const { data: changeRequest } = await safeSupabaseQuery(
        supabase
          .from('email_change_requests')
          .select('*, users(*)')
          .eq('token', token)
          .eq('verified', false)
          .gt('expires_at', new Date().toISOString())
          .single(),
        { data: null, error: null }
      );

      if (!changeRequest) {
        await this.logSecurityEvent('email_change_invalid_token', {
          token: token.substring(0, 8) + '...',
          ...clientInfo
        });
        throw new Error('Invalid or expired verification token');
      }

      // Update user email
      const { error: updateError } = await supabase
        .from('users')
        .update({
          email: changeRequest.new_email,
          email_verified: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', changeRequest.user_id);

      if (updateError) {
        throw new Error('Failed to update email');
      }

      // Mark request as verified
      await supabase
        .from('email_change_requests')
        .update({ 
          verified: true, 
          verified_at: new Date().toISOString() 
        })
        .eq('token', token);

      // Log security event
      await this.logSecurityEvent('email_change_completed', {
        user_id: changeRequest.user_id,
        old_email: changeRequest.old_email,
        new_email: changeRequest.new_email,
        ...clientInfo
      });

      // Get updated user
      const { data: updatedUser } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('*')
          .eq('id', changeRequest.user_id)
          .single(),
        { data: null, error: null }
      );

      return {
        user: this.formatUserResponse(updatedUser),
        message: 'Email updated successfully'
      };
    } catch (error: any) {
      console.error('❌ Email change verification error:', error);
      throw error;
    }
  }

  // =====================================================
  // SECURITY LOGGING AND DEVICE TRACKING
  // =====================================================

  async logSecurityEvent(event_type: string, details: any) {
    try {
      await supabase
        .from('security_logs')
        .insert({
          event_type,
          details,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  async getDeviceFingerprint(userAgent: string, ip: string): Promise<string> {
    // Create a device fingerprint based on user agent and IP
    const fingerprint = crypto
      .createHash('sha256')
      .update(userAgent + ip)
      .digest('hex')
      .substring(0, 16);
    
    return fingerprint;
  }

  async trackLoginDevice(userId: string, clientInfo: any) {
    try {
      const deviceFingerprint = await this.getDeviceFingerprint(
        clientInfo.userAgent, 
        clientInfo.ip
      );

      // Check if device is known
      const { data: existingDevice } = await safeSupabaseQuery(
        supabase
          .from('user_devices')
          .select('*')
          .eq('user_id', userId)
          .eq('device_fingerprint', deviceFingerprint)
          .single(),
        { data: null, error: null }
      );

      if (existingDevice) {
        // Update last seen
        await supabase
          .from('user_devices')
          .update({
            last_seen: new Date().toISOString(),
            login_count: existingDevice.login_count + 1
          })
          .eq('id', existingDevice.id);

        return { isNewDevice: false, device: existingDevice };
      } else {
        // Create new device record
        const deviceInfo = this.parseUserAgent(clientInfo.userAgent);
        
        const { data: newDevice } = await supabase
          .from('user_devices')
          .insert({
            user_id: userId,
            device_fingerprint: deviceFingerprint,
            device_name: deviceInfo.deviceName,
            browser: deviceInfo.browser,
            os: deviceInfo.os,
            ip_address: clientInfo.ip,
            location: await this.getLocationFromIP(clientInfo.ip),
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            login_count: 1,
            is_trusted: false
          })
          .select()
          .single();

        // Log new device login
        await this.logSecurityEvent('new_device_login', {
          user_id: userId,
          device_fingerprint: deviceFingerprint,
          device_info: deviceInfo,
          ip: clientInfo.ip,
          location: await this.getLocationFromIP(clientInfo.ip)
        });

        return { isNewDevice: true, device: newDevice };
      }
    } catch (error) {
      console.error('Device tracking error:', error);
      return { isNewDevice: false, device: null };
    }
  }

  parseUserAgent(userAgent: string) {
    // Simple user agent parsing - in production use a library like 'ua-parser-js'
    const isWindows = /Windows/.test(userAgent);
    const isMac = /Mac OS/.test(userAgent);
    const isLinux = /Linux/.test(userAgent);
    const isiOS = /iPhone|iPad/.test(userAgent);
    const isAndroid = /Android/.test(userAgent);

    const isChrome = /Chrome/.test(userAgent);
    const isFirefox = /Firefox/.test(userAgent);
    const isSafari = /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
    const isEdge = /Edge/.test(userAgent);

    return {
      deviceName: isiOS ? 'iPhone/iPad' : isAndroid ? 'Android Device' : 'Desktop',
      os: isWindows ? 'Windows' : isMac ? 'macOS' : isLinux ? 'Linux' : isiOS ? 'iOS' : isAndroid ? 'Android' : 'Unknown',
      browser: isChrome ? 'Chrome' : isFirefox ? 'Firefox' : isSafari ? 'Safari' : isEdge ? 'Edge' : 'Unknown'
    };
  }

  async getLocationFromIP(ip: string): Promise<string> {
    try {
      // In production, use a service like ipapi.co or maxmind
      // For now, return a placeholder
      if (ip === '127.0.0.1' || ip === '::1') {
        return 'Local Development';
      }
      
      // You could integrate with ipapi.co here:
      // const response = await fetch(`https://ipapi.co/${ip}/json/`);
      // const data = await response.json();
      // return `${data.city}, ${data.country_name}`;
      
      return 'Unknown Location';
    } catch (error) {
      return 'Unknown Location';
    }
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  private generateJWT(payload: Partial<JWTPayload>): string {
    return jwt.sign(
      payload,
      process.env.JWT_SECRET!,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
  }

  private formatUserResponse(user: any): User {
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      cedula_panama: user.cedula_panama,
      tax_id_type: user.tax_id_type,
      email_verified: user.email_verified,
      phone_verified: user.phone_verified,
      auth_method: user.auth_method,
      preferred_language: user.preferred_language,
      timezone: user.timezone,
      currency_code: user.currency_code,
      country_code: user.country_code,
      avatar_url: user.avatar_url,
      settings: user.settings,
      last_login_at: user.last_login_at,
      last_ip_address: user.last_ip_address,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  }

  private async getUserCompanies(userId: string) {
    const { data: memberships } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select(`
          role,
          status,
          joined_at,
          companies (
            id, razon_social, slug, description, logo_url,
            storage_used_bytes, storage_limit_gb, status,
            country_code, currency_code, industry_type,
            onboarding_completed, created_at, updated_at
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: false }),
      { data: [], error: null }
    );

    return memberships?.map((m: any) => ({
      ...m.companies,
      user_role: m.role,
      joined_at: m.joined_at,
      storage_used: Math.floor((m.companies?.storage_used_bytes || 0) / (1024 * 1024)), // MB
      storage_limit: m.companies?.storage_limit_gb * 1024 || 5120 // MB
    })) || [];
  }

  private async createUserSession(userId: string, companyId?: string): Promise<UserSession> {
    const sessionId = crypto.randomUUID();
    
    const { data: session } = await supabase
      .from('user_sessions')
      .insert({
        session_id: sessionId,
        user_id: userId,
        company_id: companyId || null,
        device_type: 'desktop', // TODO: Detectar desde user-agent
        is_active: true,
        apps_accessed: [],
        pages_visited: 0
      })
      .select()
      .single();

    return session;
  }

  private getCurrencyByCountry(countryCode: string): string {
    const currencyMap: Record<string, string> = {
      'PA': 'USD', 'SV': 'USD', 'EC': 'USD', 'PR': 'USD',
      'CR': 'CRC', 'GT': 'GTQ', 'HN': 'HNL', 'NI': 'NIO', 'BZ': 'BZD',
      'MX': 'MXN', 'AR': 'ARS', 'BO': 'BOB', 'BR': 'BRL', 'CL': 'CLP',
      'CO': 'COP', 'GY': 'GYD', 'PY': 'PYG', 'PE': 'PEN', 'SR': 'SRD',
      'UY': 'UYU', 'VE': 'VES', 'CU': 'CUP', 'DO': 'DOP',
      'US': 'USD', 'CA': 'CAD', 'SE': 'SEK', 'ES': 'EUR'
    };
    return currencyMap[countryCode] || 'USD';
  }

  private async logActivity(params: {
    company_id?: string;
    user_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    old_values?: any;
    new_values?: any;
  }) {
    try {
      await supabase.rpc('log_activity', {
        p_company_id: params.company_id || null,
        p_user_id: params.user_id,
        p_entity_type: params.entity_type,
        p_entity_id: params.entity_id,
        p_action: params.action,
        p_old_values: params.old_values || null,
        p_new_values: params.new_values || null
      });
    } catch (error) {
      console.error('❌ Audit log failed:', error);
      // No throw - audit log failure shouldn't break the flow
    }
  }

  // TODO: Implementar en producción
  private async sendEmailVerification(userId: string, email: string) {
    console.log(`📧 Email verification sent to ${email} for user ${userId}`);
    // TODO: Integrar con servicio de email (SendGrid, etc.)
  }

  private async sendPhoneVerification(userId: string, phone: string) {
    console.log(`📱 SMS verification sent to ${phone} for user ${userId}`);
    // TODO: Integrar con servicio SMS (Twilio, etc.)
  }

  // =====================================================
  // PASSWORD CHANGE
  // =====================================================

  async changePassword(userId: string, data: { current_password: string; new_password: string }) {
    try {
      const { current_password, new_password } = data;

      if (!current_password || !new_password) {
        throw new Error('Current password and new password are required');
      }

      if (new_password.length < 8) {
        throw new Error('New password must be at least 8 characters');
      }

      // Get current user
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('password_hash')
          .eq('id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isValid = await bcrypt.compare(current_password, (user as any).password_hash);
      if (!isValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(new_password, 12);

      // Update password
      const { error } = await supabase
        .from('users')
        .update({
          password_hash: newPasswordHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error('Failed to update password');
      }

      console.log('✅ Password changed successfully for user:', userId);
      return true;
    } catch (error: any) {
      console.error('❌ Change password error:', error);
      throw new Error(error.message || 'Failed to change password');
    }
  }
}