import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class AppDelegatesService {
  
  // =====================================================
  // GRANT DELEGATE - Owner makes someone delegate
  // =====================================================
  
  async grantDelegate(params: {
    appId: string;
    userId: string;
    companyId: string;
    grantedBy: string;
  }) {
    try {
      const { appId, userId, companyId, grantedBy } = params;
      
      // Only owners can grant delegate status
      const { data: granter } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', grantedBy)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      if (!granter || granter.role !== 'owner') {
        throw new Error('Only company owners can grant delegate status');
      }
      
      // Check if user is company member
      const { data: targetUser } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('user_id')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      if (!targetUser) {
        throw new Error('User must be a company member first');
      }
      
      // Check if app is installed
      const { data: appInstallation } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select('id')
          .eq('app_id', appId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      if (!appInstallation) {
        throw new Error('App must be installed in company first');
      }
      
      // Create delegate record
      const { data: delegate, error } = await supabase
        .from('app_delegates')
        .insert({
          app_id: appId,
          user_id: userId,
          company_id: companyId,
          granted_by: grantedBy,
          status: 'active'
        })
        .select()
        .single();
      
      if (error) {
        throw new Error(`Failed to create delegate: ${error.message}`);
      }
      
      return delegate;
    } catch (error: any) {
      console.error('❌ Grant delegate error:', error);
      throw new Error(error.message || 'Failed to grant delegate status');
    }
  }
  
  // =====================================================
  // REVOKE DELEGATE - Owner removes delegate status
  // =====================================================
  
  async revokeDelegate(params: {
    appId: string;
    userId: string;
    companyId: string;
    revokedBy: string;
  }) {
    try {
      const { appId, userId, companyId, revokedBy } = params;
      
      // Only owners can revoke delegate status
      const { data: revoker } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', revokedBy)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      if (!revoker || revoker.role !== 'owner') {
        throw new Error('Only company owners can revoke delegate status');
      }
      
      // Revoke delegate status
      const { error } = await supabase
        .from('app_delegates')
        .update({ status: 'revoked' })
        .eq('app_id', appId)
        .eq('user_id', userId)
        .eq('company_id', companyId);
      
      if (error) {
        throw new Error(`Failed to revoke delegate: ${error.message}`);
      }
      
      return true;
    } catch (error: any) {
      console.error('❌ Revoke delegate error:', error);
      throw new Error(error.message || 'Failed to revoke delegate status');
    }
  }
  
  // =====================================================
  // CHECK DELEGATE - Simple lookup for apps
  // =====================================================
  
  async isDelegate(params: {
    appId: string;
    userId: string;
    companyId: string;
  }): Promise<boolean> {
    try {
      const { appId, userId, companyId } = params;
      
      const { data: delegate } = await safeSupabaseQuery(
        supabase
          .from('app_delegates')
          .select('id')
          .eq('app_id', appId)
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      return !!delegate;
    } catch (error: any) {
      console.error('❌ Check delegate error:', error);
      return false;
    }
  }
  
  // =====================================================
  // LIST DELEGATES - Get all delegates for app
  // =====================================================
  
  async listDelegates(params: {
    appId: string;
    companyId: string;
    requestedBy: string;
  }) {
    try {
      const { appId, companyId, requestedBy } = params;
      
      // Only owners can view delegates
      const { data: requester } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', requestedBy)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );
      
      if (!requester || requester.role !== 'owner') {
        throw new Error('Only company owners can view delegates');
      }
      
      const { data: delegates } = await safeSupabaseQuery(
        supabase
          .from('app_delegates')
          .select(`
            id, user_id, status, created_at,
            users (first_name, last_name, email),
            granted_by_user:users!app_delegates_granted_by_fkey (first_name, last_name, email)
          `)
          .eq('app_id', appId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        { data: [], error: null }
      );
      
      return delegates?.map((delegate: any) => ({
        id: delegate.id,
        user: {
          id: delegate.user_id,
          name: `${delegate.users?.first_name} ${delegate.users?.last_name}`,
          email: delegate.users?.email
        },
        granted_by: {
          name: `${delegate.granted_by_user?.first_name} ${delegate.granted_by_user?.last_name}`,
          email: delegate.granted_by_user?.email
        },
        status: delegate.status,
        created_at: delegate.created_at
      })) || [];
    } catch (error: any) {
      console.error('❌ List delegates error:', error);
      throw new Error(error.message || 'Failed to list delegates');
    }
  }
  
  // =====================================================
  // GET USER DELEGATE APPS - Apps where user is delegate
  // =====================================================
  
  async getUserDelegateApps(params: {
    userId: string;
    companyId: string;
  }) {
    try {
      const { userId, companyId } = params;
      
      const { data: delegateApps } = await safeSupabaseQuery(
        supabase
          .from('app_delegates')
          .select(`
            app_id,
            apps (name, display_name, icon_url)
          `)
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active'),
        { data: [], error: null }
      );
      
      return delegateApps?.map((delegate: any) => ({
        app_id: delegate.app_id,
        app_name: delegate.apps?.display_name || delegate.apps?.name || 'Unknown App',
        app_icon: delegate.apps?.icon_url
      })) || [];
    } catch (error: any) {
      console.error('❌ Get user delegate apps error:', error);
      throw new Error(error.message || 'Failed to get user delegate apps');
    }
  }
}