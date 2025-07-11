import bcrypt from 'bcryptjs';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class UserService {
  async updateProfile(userId: string, data: {
    name?: string;
    full_name?: string;
    phone?: string;
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
}