import bcrypt from 'bcryptjs';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class UserService {
  async updateProfile(userId: string, data: {
    name?: string;
    full_name?: string;
    phone?: string;
    email?: string;
    avatar_url?: string;
  }) {
    try {
      const updateData: any = {};
      
      // Support both 'name' and 'full_name'
      if (data.name || data.full_name) {
        updateData.name = (data.name || data.full_name)?.trim();
      }
      
      if (data.phone !== undefined) {
        updateData.phone = data.phone?.trim() || null;
      }

      if (data.email !== undefined) {
        updateData.email = data.email?.trim() || null;
      }
      
      if (data.avatar_url !== undefined) {
        updateData.avatar_url = data.avatar_url?.trim() || null;
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No valid data to update');
      }

      updateData.updated_at = new Date().toISOString();

      const { data: user, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        throw new Error(`Update failed: ${error.message}`);
      }

      return {
        id: (user as any)?.id,
        email: (user as any)?.email,
        phone: (user as any)?.phone,
        full_name: (user as any)?.name,
        name: (user as any)?.name,
        avatar_url: (user as any)?.avatar_url,
        created_at: (user as any)?.created_at,
        updated_at: (user as any)?.updated_at,
        last_login: (user as any)?.last_login_at,
        two_factor_enabled: (user as any)?.two_factor_enabled || false,
        status: (user as any)?.status || 'active'
      };
    } catch (error: any) {
      console.error('❌ Update profile error:', error);
      throw new Error(error.message || 'Failed to update profile');
    }
  }

  async changePassword(userId: string, data: {
    current_password: string;
    new_password: string;
  }) {
    try {
      const { current_password, new_password } = data;

      if (!current_password || !new_password) {
        throw new Error('Current password and new password are required');
      }

      if (new_password.length < 6) {
        throw new Error('New password must be at least 6 characters');
      }

      // Obtener usuario actual
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

      // Verificar password actual
      const isValid = await bcrypt.compare(current_password, (user as any)?.password_hash);
      if (!isValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash nueva password
      const newPasswordHash = await bcrypt.hash(new_password, 12);

      // Actualizar password
      const { error } = await supabase
        .from('users')
        .update({
          password_hash: newPasswordHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (error) {
        throw new Error(`Password update failed: ${error.message}`);
      }

      return true;
    } catch (error: any) {
      console.error('❌ Change password error:', error);
      throw new Error(error.message || 'Failed to change password');
    }
  }

  async getUserProfile(userId: string) {
    try {
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id, name, email, phone, avatar_url, created_at, updated_at, last_login_at, two_factor_enabled, status')
          .eq('id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      return {
        id: (user as any)?.id,
        email: (user as any)?.email,
        phone: (user as any)?.phone,
        full_name: (user as any)?.name,
        name: (user as any)?.name,
        avatar_url: (user as any)?.avatar_url,
        created_at: (user as any)?.created_at,
        updated_at: (user as any)?.updated_at,
        last_login: (user as any)?.last_login_at,
        two_factor_enabled: (user as any)?.two_factor_enabled || false,
        status: (user as any)?.status || 'active'
      };
    } catch (error: any) {
      console.error('❌ Get user profile error:', error);
      throw new Error(error.message || 'Failed to get user profile');
    }
  }

  async updateNotificationPreferences(userId: string, data: {
    email_notifications?: boolean;
    sms_notifications?: boolean;
    marketing_emails?: boolean;
  }) {
    try {
      const updateData: any = {};
      
      if (data.email_notifications !== undefined) {
        updateData.email_notifications = data.email_notifications;
      }
      
      if (data.sms_notifications !== undefined) {
        updateData.sms_notifications = data.sms_notifications;
      }
      
      if (data.marketing_emails !== undefined) {
        updateData.marketing_emails = data.marketing_emails;
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No notification preferences to update');
      }

      updateData.updated_at = new Date().toISOString();

      const { data: user, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('email_notifications, sms_notifications, marketing_emails')
        .single();

      if (error) {
        throw new Error(`Notification update failed: ${error.message}`);
      }

      return user;
    } catch (error: any) {
      console.error('❌ Update notification preferences error:', error);
      throw new Error(error.message || 'Failed to update notification preferences');
    }
  }

  async getCompanyMembers(companyId: string) {
    try {
      const { data: members } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select(`
            users (
              id, first_name, last_name, email, phone, avatar_url
            )
          `)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        { data: [], error: null }
      );

      return members?.map((member: any) => member.users) || [];
    } catch (error: any) {
      console.error('❌ Get company members error:', error);
      throw new Error(error.message || 'Failed to get company members');
    }
  }
}