import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { individualOrCompanyMode } from '@/middleware/tenant';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

const router = Router();

// GET /api/dashboard/stats - Get dashboard statistics
router.get('/stats', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    let stats;
    
    if (req.user.is_individual_mode) {
      // Individual mode statistics
      const { data: personalApps } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', req.user.id)
          .eq('status', 'active'),
        { data: [], error: null }
      );

      stats = {
        active_users: 1,
        installed_apps: personalApps?.length || 0,
        storage_used_gb: 0.5, // Default for individual
        storage_limit_gb: 2, // 2GB free for individual
        api_calls_month: 1250,
        team_members: 1,
        mode: 'individual'
      };
    } else {
      // Company mode statistics
      const [appsResult, membersResult] = await Promise.all([
        safeSupabaseQuery(
          supabase
            .from('subscriptions')
            .select('*')
            .eq('company_id', req.company.id)
            .eq('status', 'active'),
          { data: [], error: null }
        ),
        safeSupabaseQuery(
          supabase
            .from('company_members')
            .select('*')
            .eq('company_id', req.company.id)
            .eq('status', 'active'),
          { data: [], error: null }
        )
      ]);

      stats = {
        active_users: membersResult.data?.length || 1,
        installed_apps: appsResult.data?.length || 0,
        storage_used_gb: 2.3,
        storage_limit_gb: 50, // Company gets 50GB
        api_calls_month: 15750,
        team_members: membersResult.data?.length || 1,
        mode: 'company'
      };
    }

    return success(res, stats);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/dashboard/activity - Get recent activity
router.get('/activity', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    
    if (req.user.is_individual_mode) {
      // Individual mode - limited activity
      const activities = [
        {
          id: '1',
          type: 'user_login',
          description: 'Iniciaste sesión',
          timestamp: new Date().toISOString(),
          user: `${req.user.first_name} ${req.user.last_name}`
        }
      ];
      
      return success(res, activities.slice(0, limit));
    }

    // Company mode - get from audit logs
    const { data: activities } = await safeSupabaseQuery(
      supabase
        .from('audit_logs')
        .select(`
          id, action, entity_type, created_at,
          users (first_name, last_name)
        `)
        .eq('company_id', req.company.id)
        .order('created_at', { ascending: false })
        .limit(limit),
      { data: [], error: null }
    );

    const formattedActivities = activities?.map((activity: any) => ({
      id: activity.id,
      type: activity.action,
      description: `${activity.action} en ${activity.entity_type}`,
      timestamp: activity.created_at,
      user: `${activity.users?.first_name} ${activity.users?.last_name}`
    })) || [];

    return success(res, formattedActivities);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/dashboard/usage - Get usage metrics
router.get('/usage', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    let usage;
    
    if (req.user.is_individual_mode) {
      usage = {
        storage: { used: 0.5, limit: 2, unit: 'GB' },
        api_calls: { used: 1250, limit: 10000, unit: 'calls/month' },
        users: { used: 1, limit: 1, unit: 'users' }
      };
    } else {
      usage = {
        storage: { used: 2.3, limit: 50, unit: 'GB' },
        api_calls: { used: 15750, limit: 100000, unit: 'calls/month' },
        users: { used: 3, limit: 50, unit: 'users' }
      };
    }

    return success(res, usage);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as dashboardRoutes };