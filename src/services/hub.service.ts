import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class HubService {
  async getDashboardData(companyId: string, userId: string) {
    try {
      // Get company stats
      const { data: company } = await safeSupabaseQuery(
        supabase
          .from('companies')
          .select('*')
          .eq('id', companyId)
          .single(),
        { data: null, error: null }
      );

      // Get member count
      const { data: members } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('id')
          .eq('company_id', companyId)
          .eq('status', 'active'),
        { data: [], error: null }
      );

      // Get installed apps count
      const { data: installedApps } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select('id')
          .eq('company_id', companyId)
          .eq('status', 'active'),
        { data: [], error: null }
      );

      // Get recent activity (placeholder for now)
      const recentActivity = [
        {
          id: '1',
          type: 'app_launch',
          message: 'Launched Elaris ERP',
          timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
          user: {
            name: 'Current User',
            avatar_url: null
          }
        },
        {
          id: '2',
          type: 'file_upload',
          message: 'Uploaded document.pdf',
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
          user: {
            name: 'Team Member',
            avatar_url: null
          }
        }
      ];

      // Calculate storage usage in MB
      const storageUsedMB = Math.floor(((company as any)?.storage_used_bytes || 0) / 1024 / 1024);
      const storageLimitMB = Math.floor(((company as any)?.storage_limit_bytes || 5368709120) / 1024 / 1024);

      return {
        company: {
          ...(company as any),
          storage_used: storageUsedMB,
          storage_limit: storageLimitMB,
          user_count: members?.length || 0
        },
        stats: {
          total_users: members?.length || 0,
          active_apps: installedApps?.length || 0,
          storage_used: storageUsedMB,
          storage_limit: storageLimitMB,
          storage_percentage: storageLimitMB > 0 ? Math.round((storageUsedMB / storageLimitMB) * 100) : 0,
          monthly_revenue: (company as any)?.monthly_revenue || 0
        },
        recent_activity: recentActivity,
        notifications: [], // TODO: Implement notifications
        quick_stats: {
          messages_today: 0, // TODO: Implement when ForvaraMail is added
          files_uploaded_today: 0, // TODO: Implement when file system is added
          active_sessions: 1 // Current user session
        }
      };
    } catch (error: any) {
      console.error('❌ Get dashboard data error:', error);
      throw new Error('Failed to get dashboard data');
    }
  }

  async getQuickActions(companyId: string, userId: string) {
    try {
      // Get user's role in company
      const { data: membership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('company_id', companyId)
          .eq('user_id', userId)
          .single(),
        { data: null, error: null }
      );

      const userRole = (membership as any)?.role || 'member';

      // Base actions for all users
      const quickActions = [
        {
          id: 'launch-apps',
          title: 'Launch Apps',
          description: 'Access your installed applications',
          icon: 'grid',
          action: '/apps',
          category: 'apps'
        },
        {
          id: 'view-files',
          title: 'Files',
          description: 'Manage your files and documents',
          icon: 'folder',
          action: '/files',
          category: 'storage'
        },
        {
          id: 'team-chat',
          title: 'Team Chat',
          description: 'Communicate with your team',
          icon: 'message-circle',
          action: '/mail',
          category: 'communication'
        }
      ];

      // Add admin actions for owners and admins
      if (['owner', 'admin'].includes(userRole)) {
        quickActions.push(
          {
            id: 'manage-team',
            title: 'Manage Team',
            description: 'Invite and manage team members',
            icon: 'users',
            action: '/team',
            category: 'management'
          },
          {
            id: 'company-settings',
            title: 'Company Settings',
            description: 'Configure company preferences',
            icon: 'settings',
            action: '/settings/company',
            category: 'management'
          }
        );
      }

      // Add owner-only actions
      if (userRole === 'owner') {
        quickActions.push(
          {
            id: 'billing',
            title: 'Billing & Subscriptions',
            description: 'Manage billing and app subscriptions',
            icon: 'credit-card',
            action: '/billing',
            category: 'billing'
          },
          {
            id: 'analytics',
            title: 'Analytics',
            description: 'View usage and performance metrics',
            icon: 'bar-chart',
            action: '/analytics',
            category: 'analytics'
          }
        );
      }

      return quickActions;
    } catch (error: any) {
      console.error('❌ Get quick actions error:', error);
      throw new Error('Failed to get quick actions');
    }
  }
}