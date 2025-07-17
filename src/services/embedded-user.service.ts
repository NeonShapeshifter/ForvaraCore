import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';
import crypto from 'crypto';

export class EmbeddedUserService {
  
  // =====================================================
  // GET APP USERS
  // Returns users who have access to specific app
  // =====================================================
  
  async getAppUsers(appId: string, contextId: string, contextType: 'user' | 'company') {
    try {
      if (contextType === 'user') {
        // Individual mode: only return the user themselves
        const { data: user } = await safeSupabaseQuery(
          supabase
            .from('users')
            .select('id, first_name, last_name, email, phone, avatar_url')
            .eq('id', contextId)
            .single(),
          { data: null, error: null }
        );
        
        return user ? [{
          ...user,
          role: 'owner',
          permissions: ['*'], // Individual users have all permissions
          access_level: 'full',
          joined_at: new Date().toISOString()
        }] : [];
      }
      
      // Company mode: get all company members with app access
      const { data: members } = await safeSupabaseQuery(
        supabase
          .from('app_members')
          .select(`
            id, role, permissions, access_level, joined_at,
            users (
              id, first_name, last_name, email, phone, avatar_url
            )
          `)
          .eq('app_id', appId)
          .eq('company_id', contextId)
          .eq('status', 'active')
          .order('joined_at', { ascending: false }),
        { data: [], error: null }
      );
      
      return members?.map((member: any) => ({
        ...member.users,
        role: member.role,
        permissions: member.permissions,
        access_level: member.access_level,
        joined_at: member.joined_at,
        app_member_id: member.id
      })) || [];
    } catch (error: any) {
      console.error('❌ Get app users error:', error);
      throw new Error('Failed to get app users');
    }
  }
  
  // =====================================================
  // INVITE USER TO APP
  // Invites a user to have access to specific app
  // =====================================================
  
  async inviteToApp(
    appId: string, 
    companyId: string, 
    inviteData: { email?: string; phone?: string; role: string; permissions: string[] },
    invitedBy: string
  ) {
    try {
      const { email, phone, role, permissions } = inviteData;
      
      if (!email && !phone) {
        throw new Error('Email or phone is required for invitation');
      }
      
      // Check if user exists
      let targetUser = null;
      if (email) {
        const { data: user } = await safeSupabaseQuery(
          supabase
            .from('users')
            .select('id, first_name, last_name, email')
            .eq('email', email.toLowerCase())
            .single(),
          { data: null, error: null }
        );
        targetUser = user;
      } else if (phone) {
        const { data: user } = await safeSupabaseQuery(
          supabase
            .from('users')
            .select('id, first_name, last_name, phone')
            .eq('phone', phone)
            .single(),
          { data: null, error: null }
        );
        targetUser = user;
      }
      
      if (!targetUser) {
        throw new Error('User not found. They must register first.');
      }
      
      // Check if user is already a company member
      const { data: companyMember } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('id, status')
          .eq('user_id', targetUser.id)
          .eq('company_id', companyId)
          .single(),
        { data: null, error: null }
      );
      
      if (!companyMember) {
        throw new Error('User must be a company member first');
      }
      
      // Check if already has app access
      const { data: existingAccess } = await safeSupabaseQuery(
        supabase
          .from('app_members')
          .select('id')
          .eq('user_id', targetUser.id)
          .eq('app_id', appId)
          .eq('company_id', companyId)
          .single(),
        { data: null, error: null }
      );
      
      if (existingAccess) {
        throw new Error('User already has access to this app');
      }
      
      // Create app member record
      const { data: appMember, error } = await supabase
        .from('app_members')
        .insert({
          user_id: targetUser.id,
          app_id: appId,
          company_id: companyId,
          role: role,
          permissions: permissions,
          access_level: 'standard',
          status: 'active',
          invited_by: invitedBy,
          joined_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to grant app access: ${error.message}`);
      }
      
      // Log activity
      await this.logActivity({
        company_id: companyId,
        user_id: invitedBy,
        entity_type: 'app_member',
        entity_id: appMember.id,
        action: 'invite',
        new_values: {
          invited_user: targetUser.id,
          app_id: appId,
          role: role,
          permissions: permissions
        }
      });
      
      return {
        ...appMember,
        user: targetUser,
        message: `${targetUser.first_name} now has access to this app`
      };
    } catch (error: any) {
      console.error('❌ Invite to app error:', error);
      throw new Error(error.message || 'Failed to invite user to app');
    }
  }
  
  // =====================================================
  // UPDATE APP MEMBER
  // Updates user permissions within specific app
  // =====================================================
  
  async updateAppMember(
    appId: string,
    companyId: string,
    userId: string,
    updates: { permissions?: string[]; role?: string },
    updatedBy: string
  ) {
    try {
      const { data: member, error } = await supabase
        .from('app_members')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('app_id', appId)
        .eq('company_id', companyId)
        .select(`
          id, role, permissions, access_level, joined_at,
          users (
            id, first_name, last_name, email, phone, avatar_url
          )
        `)
        .single();
      
      if (error) {
        throw new Error(`Failed to update app member: ${error.message}`);
      }
      
      // Log activity
      await this.logActivity({
        company_id: companyId,
        user_id: updatedBy,
        entity_type: 'app_member',
        entity_id: member.id,
        action: 'update',
        new_values: updates
      });
      
      return {
        ...member.users,
        role: member.role,
        permissions: member.permissions,
        access_level: member.access_level,
        joined_at: member.joined_at,
        app_member_id: member.id
      };
    } catch (error: any) {
      console.error('❌ Update app member error:', error);
      throw new Error(error.message || 'Failed to update app member');
    }
  }
  
  // =====================================================
  // REMOVE FROM APP
  // Removes user access from specific app
  // =====================================================
  
  async removeFromApp(appId: string, companyId: string, userId: string, removedBy: string) {
    try {
      const { error } = await supabase
        .from('app_members')
        .update({
          status: 'removed',
          removed_at: new Date().toISOString(),
          removed_by: removedBy
        })
        .eq('user_id', userId)
        .eq('app_id', appId)
        .eq('company_id', companyId);
      
      if (error) {
        throw new Error(`Failed to remove user from app: ${error.message}`);
      }
      
      // Log activity
      await this.logActivity({
        company_id: companyId,
        user_id: removedBy,
        entity_type: 'app_member',
        entity_id: userId,
        action: 'remove',
        new_values: {
          app_id: appId,
          removed_by: removedBy
        }
      });
      
      return true;
    } catch (error: any) {
      console.error('❌ Remove from app error:', error);
      throw new Error(error.message || 'Failed to remove user from app');
    }
  }
  
  // =====================================================
  // GET AVAILABLE USERS
  // Returns company members who don't have app access yet
  // =====================================================
  
  async getAvailableUsers(appId: string, companyId: string) {
    try {
      const { data: availableUsers } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select(`
            users (
              id, first_name, last_name, email, phone, avatar_url
            )
          `)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .not('user_id', 'in', 
            supabase
              .from('app_members')
              .select('user_id')
              .eq('app_id', appId)
              .eq('company_id', companyId)
              .eq('status', 'active')
          ),
        { data: [], error: null }
      );
      
      return availableUsers?.map((member: any) => member.users) || [];
    } catch (error: any) {
      console.error('❌ Get available users error:', error);
      throw new Error('Failed to get available users');
    }
  }
  
  // =====================================================
  // GET APP PERMISSIONS
  // Returns available permissions for specific app
  // =====================================================
  
  async getAppPermissions(appId: string) {
    try {
      const { data: app } = await safeSupabaseQuery(
        supabase
          .from('apps')
          .select('permissions_schema')
          .eq('id', appId)
          .single(),
        { data: null, error: null }
      );
      
      // Default permissions if app doesn't have custom schema
      const defaultPermissions = [
        { id: 'read', name: 'Ver datos', description: 'Puede ver información de la app' },
        { id: 'write', name: 'Editar datos', description: 'Puede crear y modificar datos' },
        { id: 'delete', name: 'Eliminar datos', description: 'Puede eliminar información' },
        { id: 'admin', name: 'Administrar', description: 'Acceso completo a todas las funciones' }
      ];
      
      return app?.permissions_schema || defaultPermissions;
    } catch (error: any) {
      console.error('❌ Get app permissions error:', error);
      throw new Error('Failed to get app permissions');
    }
  }
  
  // =====================================================
  // UTILITY METHODS
  // =====================================================
  
  private async logActivity(params: {
    company_id: string;
    user_id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    old_values?: any;
    new_values?: any;
  }) {
    try {
      await supabase.rpc('log_activity', {
        p_company_id: params.company_id,
        p_user_id: params.user_id,
        p_entity_type: params.entity_type,
        p_entity_id: params.entity_id,
        p_action: params.action,
        p_old_values: params.old_values || null,
        p_new_values: params.new_values || null
      });
    } catch (error) {
      console.error('❌ Audit log failed:', error);
      // Don't throw - audit log failure shouldn't break the flow
    }
  }
}