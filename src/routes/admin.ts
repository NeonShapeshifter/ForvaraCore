import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { requireAdmin } from '@/middleware/auth';
import { AuthRequest } from '@/types/index.js';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

const router = Router();

// All admin routes require admin authentication
router.use(requireAdmin);

// =====================================================
// ADMIN DASHBOARD OVERVIEW
// =====================================================

router.get('/dashboard', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    // Get total stats
    const { data: companiesCount } = await safeSupabaseQuery(
      supabase.from('companies').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    const { data: usersCount } = await safeSupabaseQuery(
      supabase.from('users').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    const { data: activeCompanies } = await safeSupabaseQuery(
      supabase.from('companies').select('id', { count: 'exact' }).eq('status', 'active'),
      { data: [], error: null }
    );

    const { data: trialCompanies } = await safeSupabaseQuery(
      supabase.from('companies').select('id', { count: 'exact' }).eq('status', 'trial'),
      { data: [], error: null }
    );

    // Get recent activity (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentCompanies } = await safeSupabaseQuery(
      supabase
        .from('companies')
        .select('id, razon_social, created_at, status')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      { data: [], error: null }
    );

    const { data: recentUsers } = await safeSupabaseQuery(
      supabase
        .from('users')
        .select('id, first_name, last_name, email, created_at')
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(10),
      { data: [], error: null }
    );

    const dashboard = {
      overview: {
        total_companies: companiesCount?.length || 0,
        total_users: usersCount?.length || 0,
        active_companies: activeCompanies?.length || 0,
        trial_companies: trialCompanies?.length || 0,
        revenue_monthly: 0, // TODO: Calculate from subscriptions
        revenue_total: 0, // TODO: Calculate from payments
      },
      recent_activity: {
        companies: recentCompanies || [],
        users: recentUsers || []
      },
      growth: {
        companies_this_month: recentCompanies?.length || 0,
        users_this_month: recentUsers?.length || 0
      }
    };

    return success(res, dashboard);
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// COMPANY MANAGEMENT
// =====================================================

router.get('/companies', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('companies')
      .select(`
        id, razon_social, ruc, status, created_at, updated_at,
        trial_ends_at, storage_used_bytes, storage_limit_gb,
        slots_limit, onboarding_completed, industry_type,
        country_code, currency_code
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (search) {
      query = query.or(`razon_social.ilike.%${search}%,ruc.ilike.%${search}%`);
    }

    if (status) {
      query = query.eq('status', status);
    }

    const { data: companies } = await safeSupabaseQuery(query, { data: [], error: null });

    // Get total count for pagination
    const { data: totalCount } = await safeSupabaseQuery(
      supabase.from('companies').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    return success(res, {
      companies: companies || [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount?.length || 0,
        pages: Math.ceil((totalCount?.length || 0) / Number(limit))
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

router.get('/companies/:id', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;

    // Get company details
    const { data: company } = await safeSupabaseQuery(
      supabase
        .from('companies')
        .select('*')
        .eq('id', id)
        .single(),
      { data: null, error: null }
    );

    if (!company) {
      return error(res, 'Company not found', 404);
    }

    // Get company members
    const { data: members } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select(`
          user_id, role, status, joined_at,
          users (first_name, last_name, email, phone)
        `)
        .eq('company_id', id),
      { data: [], error: null }
    );

    // Get usage stats
    const { data: sessions } = await safeSupabaseQuery(
      supabase
        .from('user_sessions')
        .select('id, created_at, user_id')
        .in('user_id', (members || []).map((m: any) => m.user_id))
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      { data: [], error: null }
    );

    return success(res, {
      company,
      members: members || [],
      stats: {
        total_members: members?.length || 0,
        sessions_last_30_days: sessions?.length || 0,
        storage_used_percent: company.storage_used_bytes / (company.storage_limit_gb * 1024 * 1024 * 1024) * 100
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// USER MANAGEMENT
// =====================================================

router.get('/users', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('users')
      .select(`
        id, first_name, last_name, email, phone, status,
        created_at, last_login_at, country_code, auth_method
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (search) {
      query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { data: users } = await safeSupabaseQuery(query, { data: [], error: null });

    // Get total count
    const { data: totalCount } = await safeSupabaseQuery(
      supabase.from('users').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    return success(res, {
      users: users || [],
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount?.length || 0,
        pages: Math.ceil((totalCount?.length || 0) / Number(limit))
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// SYSTEM ANALYTICS
// =====================================================

router.get('/analytics', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { period = '30d' } = req.query;
    
    // Calculate date range
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get daily registration stats
    const { data: dailyRegistrations } = await safeSupabaseQuery(
      supabase
        .from('companies')
        .select('created_at')
        .gte('created_at', startDate)
        .order('created_at', { ascending: true }),
      { data: [], error: null }
    );

    // Get daily user registrations
    const { data: dailyUsers } = await safeSupabaseQuery(
      supabase
        .from('users')
        .select('created_at')
        .gte('created_at', startDate)
        .order('created_at', { ascending: true }),
      { data: [], error: null }
    );

    // Process data by day
    const registrationsByDay: { [key: string]: { companies: number; users: number } } = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      registrationsByDay[dateKey] = { companies: 0, users: 0 };
    }

    // Count registrations by day
    dailyRegistrations?.forEach((reg: any) => {
      const dateKey = reg.created_at.split('T')[0];
      if (registrationsByDay[dateKey]) {
        registrationsByDay[dateKey].companies++;
      }
    });

    dailyUsers?.forEach((user: any) => {
      const dateKey = user.created_at.split('T')[0];
      if (registrationsByDay[dateKey]) {
        registrationsByDay[dateKey].users++;
      }
    });

    const chartData = Object.entries(registrationsByDay)
      .map(([date, counts]) => ({
        date,
        companies: counts.companies,
        users: counts.users
      }))
      .reverse();

    return success(res, {
      period,
      chart_data: chartData,
      totals: {
        companies: dailyRegistrations?.length || 0,
        users: dailyUsers?.length || 0
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// =====================================================
// APP STORE MANAGEMENT - EMPEROR CONTROLS 👑
// =====================================================

// GET /api/admin/apps - Manage all marketplace apps
router.get('/apps', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('apps')
      .select(`
        id, name, display_name, slug, description, short_description,
        category, is_active, is_featured, is_free, base_price_monthly,
        features, version, created_at, updated_at, 
        icon_url, screenshots, supported_countries, install_count
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (search) {
      query = query.or(`name.ilike.%${search}%,display_name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    if (category) {
      query = query.eq('category', category);
    }

    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    }

    const { data: apps } = await safeSupabaseQuery(query, { data: [], error: null });

    // Get installation stats for each app
    const appStats = await Promise.all(
      (apps || []).map(async (app: any) => {
        const { data: installations } = await safeSupabaseQuery(
          supabase
            .from('app_installations')
            .select('id, status, created_at')
            .eq('app_id', app.id),
          { data: [], error: null }
        );

        return {
          ...app,
          stats: {
            total_installations: installations?.length || 0,
            active_installations: installations?.filter((i: any) => i.status === 'active').length || 0,
            trial_installations: installations?.filter((i: any) => i.status === 'trial').length || 0,
          }
        };
      })
    );

    const { data: totalCount } = await safeSupabaseQuery(
      supabase.from('apps').select('id', { count: 'exact' }),
      { data: [], error: null }
    );

    return success(res, {
      apps: appStats,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount?.length || 0,
        pages: Math.ceil((totalCount?.length || 0) / Number(limit))
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// POST /api/admin/apps - Create new app (APP STORE EMPEROR POWER!)
router.post('/apps', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const {
      name,
      display_name,
      description,
      short_description,
      category,
      base_price_monthly,
      is_free = false,
      is_featured = false,
      features = {},
      supported_countries = ['PA', 'MX', 'CO', 'CR', 'GT'], // Default LATAM countries
      icon_url,
      screenshot_urls = [],
      version = '1.0.0'
    } = req.body;

    if (!name || !display_name || !description || !category) {
      return error(res, 'Name, display name, description, and category are required', 400);
    }

    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check if slug already exists
    const { data: existingApp } = await safeSupabaseQuery(
      supabase.from('apps').select('id').eq('slug', slug).single(),
      { data: null, error: null }
    );

    if (existingApp) {
      return error(res, 'App with this name already exists', 409);
    }

    const { data: newApp, error: createError } = await supabase
      .from('apps')
      .insert({
        name,
        display_name,
        slug,
        description,
        category,
        is_active: true,
        is_featured,
        is_free,
        base_price_monthly: is_free ? 0 : base_price_monthly
      })
      .select()
      .single();

    if (createError) {
      return error(res, `Failed to create app: ${createError.message}`, 500);
    }

    return success(res, newApp, 201);
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// PUT /api/admin/apps/:id - Update app (EMPEROR EDIT POWERS!)
router.put('/apps/:id', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove fields that shouldn't be updated directly
    delete updateData.id;
    delete updateData.created_at;

    const { data: updatedApp, error: updateError } = await supabase
      .from('apps')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return error(res, `Failed to update app: ${updateError.message}`, 500);
    }

    if (!updatedApp) {
      return error(res, 'App not found', 404);
    }

    return success(res, updatedApp);
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// DELETE /api/admin/apps/:id - Delete app (EMPEROR DESTRUCTION!)
router.delete('/apps/:id', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;

    // Check if app has active installations
    const { data: installations } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .select('id')
        .eq('app_id', id)
        .eq('status', 'active'),
      { data: [], error: null }
    );

    if (installations && installations.length > 0) {
      return error(res, 'Cannot delete app with active installations. Deactivate first.', 409);
    }

    const { error: deleteError } = await supabase
      .from('apps')
      .delete()
      .eq('id', id);

    if (deleteError) {
      return error(res, `Failed to delete app: ${deleteError.message}`, 500);
    }

    return success(res, { message: 'App deleted successfully' });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// POST /api/admin/apps/:id/feature - Toggle featured status (PROMOTION EMPEROR!)
router.post('/apps/:id/feature', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;

    const { data: updatedApp, error: updateError } = await supabase
      .from('apps')
      .update({ is_featured: featured })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return error(res, `Failed to update featured status: ${updateError.message}`, 500);
    }

    return success(res, {
      app: updatedApp,
      message: `App ${featured ? 'featured' : 'unfeatured'} successfully`
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// GET /api/admin/apps/:id/analytics - App revenue and usage analytics (EMPEROR INSIGHTS!)
router.get('/apps/:id/analytics', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    const { id } = req.params;
    const { period = '30d' } = req.query;

    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Get app installations over time
    const { data: installations } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .select('created_at, status, company_id')
        .eq('app_id', id)
        .gte('created_at', startDate)
        .order('created_at', { ascending: true }),
      { data: [], error: null }
    );

    // Get app revenue (from subscriptions)
    const { data: subscriptions } = await safeSupabaseQuery(
      supabase
        .from('subscriptions')
        .select('amount, currency, status, created_at')
        .eq('app_id', id)
        .gte('created_at', startDate),
      { data: [], error: null }
    );

    // Process daily stats
    const dailyStats: { [key: string]: { installations: number; revenue: number } } = {};
    
    for (let i = 0; i < days; i++) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      dailyStats[dateKey] = { installations: 0, revenue: 0 };
    }

    // Count installations by day
    installations?.forEach((install: any) => {
      const dateKey = install.created_at.split('T')[0];
      if (dailyStats[dateKey]) {
        dailyStats[dateKey].installations++;
      }
    });

    // Sum revenue by day
    subscriptions?.forEach((sub: any) => {
      const dateKey = sub.created_at.split('T')[0];
      if (dailyStats[dateKey]) {
        dailyStats[dateKey].revenue += sub.amount || 0;
      }
    });

    const chartData = Object.entries(dailyStats)
      .map(([date, stats]) => ({
        date,
        installations: stats.installations,
        revenue: stats.revenue
      }))
      .reverse();

    // Calculate totals
    const totalRevenue = subscriptions?.reduce((sum: number, sub: any) => sum + (sub.amount || 0), 0) || 0;
    const activeInstallations = installations?.filter((i: any) => i.status === 'active').length || 0;

    return success(res, {
      period,
      chart_data: chartData,
      totals: {
        installations: installations?.length || 0,
        active_installations: activeInstallations,
        total_revenue: totalRevenue,
        average_revenue_per_user: activeInstallations > 0 ? totalRevenue / activeInstallations : 0
      }
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

// GET /api/admin/marketplace/stats - Overall marketplace statistics (EMPIRE OVERVIEW!)
router.get('/marketplace/stats', safeAsync(async (req: AuthRequest, res: any) => {
  try {
    // Get app counts by category
    const { data: apps } = await safeSupabaseQuery(
      supabase.from('apps').select('category, is_active, is_featured'),
      { data: [], error: null }
    );

    // Get total installations and revenue
    const { data: installations } = await safeSupabaseQuery(
      supabase.from('app_installations').select('status, created_at'),
      { data: [], error: null }
    );

    const { data: subscriptions } = await safeSupabaseQuery(
      supabase.from('subscriptions').select('amount, status'),
      { data: [], error: null }
    );

    // Process statistics
    const categories = apps?.reduce((acc: any, app: any) => {
      if (!acc[app.category]) {
        acc[app.category] = { total: 0, active: 0, featured: 0 };
      }
      acc[app.category].total++;
      if (app.is_active) acc[app.category].active++;
      if (app.is_featured) acc[app.category].featured++;
      return acc;
    }, {}) || {};

    const totalRevenue = subscriptions?.reduce((sum: number, sub: any) => 
      sum + (sub.status === 'active' ? sub.amount || 0 : 0), 0) || 0;

    return success(res, {
      overview: {
        total_apps: apps?.length || 0,
        active_apps: apps?.filter((a: any) => a.is_active).length || 0,
        featured_apps: apps?.filter((a: any) => a.is_featured).length || 0,
        total_installations: installations?.length || 0,
        active_installations: installations?.filter((i: any) => i.status === 'active').length || 0,
        total_revenue: totalRevenue
      },
      categories,
      recent_installations: installations?.slice(-10) || []
    });
  } catch (err: any) {
    return error(res, err.message, 500);
  }
}));

export { router as adminRoutes };