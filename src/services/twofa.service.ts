import crypto from 'crypto';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';
import { EmailService } from './email.service.js';

export class TwoFAService {
  private emailService = new EmailService();

  // Generate a 6-digit OTP
  generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Generate a backup code
  generateBackupCode(): string {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  // Setup 2FA for a user
  async setup2FA(userId: string, method: 'email' | 'sms' = 'email') {
    try {
      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () => this.generateBackupCode());
      
      // Check if 2FA is already enabled
      const { data: existing2FA } = await safeSupabaseQuery(
        supabase
          .from('user_2fa')
          .select('*')
          .eq('user_id', userId)
          .single(),
        { data: null, error: null }
      );

      if (existing2FA) {
        // Update existing 2FA
        const { data: updated2FA, error: updateError } = await supabase
          .from('user_2fa')
          .update({
            method,
            backup_codes: backupCodes,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .select()
          .single();

        if (updateError) {
          throw new Error('Failed to update 2FA settings');
        }

        return {
          backup_codes: backupCodes,
          method,
          message: '2FA updated successfully'
        };
      } else {
        // Create new 2FA setup
        const { data: new2FA, error: insertError } = await supabase
          .from('user_2fa')
          .insert({
            user_id: userId,
            method,
            is_enabled: false, // Will be enabled after verification
            backup_codes: backupCodes,
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) {
          throw new Error('Failed to setup 2FA');
        }

        return {
          backup_codes: backupCodes,
          method,
          message: '2FA setup initialized. Please verify to enable.'
        };
      }
    } catch (error: any) {
      console.error('❌ 2FA setup error:', error);
      throw error;
    }
  }

  // Send 2FA code
  async send2FACode(userId: string, method?: string) {
    try {
      // Get user details and 2FA settings
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('email, phone, first_name')
          .eq('id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      const { data: user2FA } = await safeSupabaseQuery(
        supabase
          .from('user_2fa')
          .select('*')
          .eq('user_id', userId)
          .single(),
        { data: null, error: null }
      );

      const deliveryMethod = method || user2FA?.method || 'email';
      const otp = this.generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store the OTP
      const { error: storeError } = await supabase
        .from('user_2fa_codes')
        .insert({
          user_id: userId,
          code: otp,
          method: deliveryMethod,
          expires_at: expiresAt.toISOString(),
          used: false
        });

      if (storeError) {
        throw new Error('Failed to store verification code');
      }

      // Send the code
      if (deliveryMethod === 'email') {
        await this.emailService.send2FACode(user.email, user.first_name, otp);
      } else if (deliveryMethod === 'sms') {
        // TODO: Implement SMS sending
        console.log(`SMS 2FA code for ${user.phone}: ${otp}`);
      }

      return {
        message: 'Verification code sent',
        method: deliveryMethod,
        expires_in: 600 // 10 minutes in seconds
      };
    } catch (error: any) {
      console.error('❌ Send 2FA code error:', error);
      throw error;
    }
  }

  // Verify 2FA code
  async verify2FACode(userId: string, code: string, enableAfterVerification = false) {
    try {
      // Find valid code
      const { data: validCode } = await safeSupabaseQuery(
        supabase
          .from('user_2fa_codes')
          .select('*')
          .eq('user_id', userId)
          .eq('code', code)
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single(),
        { data: null, error: null }
      );

      if (!validCode) {
        // Check if it's a backup code
        const isBackupCode = await this.verifyBackupCode(userId, code);
        if (!isBackupCode) {
          throw new Error('Invalid or expired verification code');
        }
        return { verified: true, used_backup_code: true };
      }

      // Mark code as used
      await supabase
        .from('user_2fa_codes')
        .update({ used: true, used_at: new Date().toISOString() })
        .eq('id', validCode.id);

      // Enable 2FA if requested
      if (enableAfterVerification) {
        await supabase
          .from('user_2fa')
          .update({ 
            is_enabled: true,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
      }

      return { 
        verified: true, 
        message: enableAfterVerification ? '2FA enabled successfully' : 'Code verified'
      };
    } catch (error: any) {
      console.error('❌ Verify 2FA code error:', error);
      throw error;
    }
  }

  // Verify backup code
  async verifyBackupCode(userId: string, backupCode: string): Promise<boolean> {
    try {
      const { data: user2FA } = await safeSupabaseQuery(
        supabase
          .from('user_2fa')
          .select('backup_codes')
          .eq('user_id', userId)
          .eq('is_enabled', true)
          .single(),
        { data: null, error: null }
      );

      if (!user2FA || !user2FA.backup_codes) {
        return false;
      }

      const backupCodes = user2FA.backup_codes as string[];
      const codeIndex = backupCodes.indexOf(backupCode.toUpperCase());

      if (codeIndex === -1) {
        return false;
      }

      // Remove used backup code
      const updatedCodes = backupCodes.filter((_, index) => index !== codeIndex);
      
      await supabase
        .from('user_2fa')
        .update({ 
          backup_codes: updatedCodes,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      return true;
    } catch (error) {
      console.error('❌ Verify backup code error:', error);
      return false;
    }
  }

  // Disable 2FA
  async disable2FA(userId: string) {
    try {
      const { error: disableError } = await supabase
        .from('user_2fa')
        .update({ 
          is_enabled: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (disableError) {
        throw new Error('Failed to disable 2FA');
      }

      // Invalidate all pending codes
      await supabase
        .from('user_2fa_codes')
        .update({ used: true })
        .eq('user_id', userId)
        .eq('used', false);

      return { message: '2FA disabled successfully' };
    } catch (error: any) {
      console.error('❌ Disable 2FA error:', error);
      throw error;
    }
  }

  // Check if user has 2FA enabled
  async is2FAEnabled(userId: string): Promise<boolean> {
    try {
      const { data: user2FA } = await safeSupabaseQuery(
        supabase
          .from('user_2fa')
          .select('is_enabled')
          .eq('user_id', userId)
          .single(),
        { data: null, error: null }
      );

      return user2FA?.is_enabled || false;
    } catch (error) {
      return false;
    }
  }

  // Get 2FA status
  async get2FAStatus(userId: string) {
    try {
      const { data: user2FA } = await safeSupabaseQuery(
        supabase
          .from('user_2fa')
          .select('method, is_enabled, backup_codes, created_at')
          .eq('user_id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user2FA) {
        return {
          enabled: false,
          method: null,
          backup_codes_remaining: 0
        };
      }

      return {
        enabled: user2FA.is_enabled,
        method: user2FA.method,
        backup_codes_remaining: (user2FA.backup_codes as string[])?.length || 0,
        setup_date: user2FA.created_at
      };
    } catch (error: any) {
      console.error('❌ Get 2FA status error:', error);
      throw error;
    }
  }
}