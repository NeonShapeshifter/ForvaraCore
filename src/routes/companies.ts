import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

const router = Router();

// All endpoints require authentication
router.use(authenticate);

// GET /api/companies/:id/apps - Get company's installed apps
router.get('/:id/apps', safeAsync(async (req: any, res: any) => {
  try {
    const { id: companyId } = req.params;

    // Verify user has access to this company
    const { data: membership } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', req.user.id)
        .eq('status', 'active')
        .single(),
      { data: null, error: null }
    );

    if (!membership) {
      return error(res, 'Access denied to this company', 403);
    }

    // Get company's app installations
    const { data: installations } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .select(`
          id, status, created_at,
          apps (
            id, name, description, category, 
            pricing_model, base_price, logo_url
          )
        `)
        .eq('company_id', companyId)
        .eq('status', 'active'),
      { data: [], error: null }
    );

    // Transform to match frontend interface
    const installedApps = installations?.map((installation: any) => ({
      id: installation.apps.id,
      name: installation.apps.name,
      description: installation.apps.description,
      category: installation.apps.category,
      status: 'active',
      subscription: {
        plan: installation.apps.pricing_model || 'free',
        price: installation.apps.base_price ? `$${installation.apps.base_price}` : 'Gratis',
        billingCycle: 'monthly',
        nextBilling: null, // Calculate based on installation date
        trialEnds: null
      },
      usage: {
        lastAccessed: installation.created_at,
        monthlyActiveUsers: Math.floor(Math.random() * 10) + 1, // Mock data for now
        storageUsed: `${(Math.random() * 500).toFixed(1)}MB`,
        apiCalls: Math.floor(Math.random() * 1000) + 100
      },
      permissions: ['read', 'write'], // Would come from permissions table
      installedDate: installation.created_at
    })) || [];

    // Add fallback mock data if no apps installed
    if (installedApps.length === 0) {
      return success(res, [
        {
          id: 'sample-app-1',
          name: 'Elaris Contabilidad',
          description: 'Módulo de contabilidad empresarial',
          category: 'Contabilidad',
          status: 'trial',
          subscription: {
            plan: 'trial',
            price: '$29',
            billingCycle: 'monthly',
            nextBilling: null,
            trialEnds: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          },
          usage: {
            lastAccessed: new Date().toISOString(),
            monthlyActiveUsers: 3,
            storageUsed: '125.3MB',
            apiCalls: 450
          },
          permissions: ['read', 'write'],
          installedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]);
    }

    return success(res, installedApps);
  } catch (err: any) {
    console.error('Error fetching company apps:', err);
    return error(res, err.message, 500);
  }
}));

// POST /api/companies/:id/apps/:appId/install - Install app for company
router.post('/:id/apps/:appId/install', safeAsync(async (req: any, res: any) => {
  try {
    const { id: companyId, appId } = req.params;
    const { planId } = req.body;

    // Verify user has admin access to this company
    const { data: membership } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', req.user.id)
        .eq('status', 'active')
        .in('role', ['admin', 'owner'])
        .single(),
      { data: null, error: null }
    );

    if (!membership) {
      return error(res, 'Admin access required', 403);
    }

    // Check if app exists
    const { data: app } = await safeSupabaseQuery(
      supabase
        .from('apps')
        .select('*')
        .eq('id', appId)
        .eq('status', 'published')
        .single(),
      { data: null, error: null }
    );

    if (!app) {
      return error(res, 'App not found', 404);
    }

    // Check if already installed
    const { data: existingInstallation } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .select('*')
        .eq('company_id', companyId)
        .eq('app_id', appId)
        .single(),
      { data: null, error: null }
    );

    if (existingInstallation) {
      return error(res, 'App already installed', 400);
    }

    // Install the app
    const { data: installation } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .insert([{
          company_id: companyId,
          app_id: appId,
          installed_by: req.user.id,
          status: 'active',
          plan_id: planId
        }])
        .select()
        .single(),
      { data: null, error: null }
    );

    if (!installation) {
      return error(res, 'Failed to install app', 500);
    }

    return success(res, {
      message: 'App installed successfully',
      installation: installation
    }, 201);
  } catch (err: any) {
    console.error('Error installing app:', err);
    return error(res, err.message, 500);
  }
}));

// DELETE /api/companies/:id/apps/:appId - Uninstall app
router.delete('/:id/apps/:appId', safeAsync(async (req: any, res: any) => {
  try {
    const { id: companyId, appId } = req.params;

    // Verify user has admin access
    const { data: membership } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select('*')
        .eq('company_id', companyId)
        .eq('user_id', req.user.id)
        .eq('status', 'active')
        .in('role', ['admin', 'owner'])
        .single(),
      { data: null, error: null }
    );

    if (!membership) {
      return error(res, 'Admin access required', 403);
    }

    // Update installation status to 'uninstalled'
    const { data: installation } = await safeSupabaseQuery(
      supabase
        .from('app_installations')
        .update({ 
          status: 'uninstalled',
          uninstalled_at: new Date().toISOString(),
          uninstalled_by: req.user.id
        })
        .eq('company_id', companyId)
        .eq('app_id', appId)
        .select()
        .single(),
      { data: null, error: null }
    );

    if (!installation) {
      return error(res, 'App installation not found', 404);
    }

    return success(res, {
      message: 'App uninstalled successfully'
    });
  } catch (err: any) {
    console.error('Error uninstalling app:', err);
    return error(res, err.message, 500);
  }
}));

export { router as companiesRoutes };