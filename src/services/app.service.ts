import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class AppService {
  async getApps() {
    try {
      const { data: apps } = await safeSupabaseQuery(
        supabase
          .from('apps')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        { data: [], error: null }
      );

      return apps || [];
    } catch (error: any) {
      console.error('❌ Get apps error:', error);
      throw new Error('Failed to get apps');
    }
  }

  async getApp(appId: string) {
    try {
      const { data: app } = await safeSupabaseQuery(
        supabase
          .from('apps')
          .select('*')
          .eq('id', appId)
          .eq('is_active', true)
          .single(),
        { data: null, error: null }
      );

      if (!app) {
        throw new Error('App not found');
      }

      return app as any;
    } catch (error: any) {
      console.error('❌ Get app error:', error);
      throw new Error(error.message || 'Failed to get app');
    }
  }

  async getInstalledApps(companyId: string) {
    try {
      const { data: subscriptions } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select(`
            id, status, plan_name, features, created_at,
            apps (
              id, name, display_name, description, icon_url, category
            )
          `)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .order('created_at'),
        { data: [], error: null }
      );

      return subscriptions?.map((s: any) => ({
        subscription_id: s.id,
        status: s.status,
        plan: s.plan_name,
        features: s.features,
        installed_at: s.created_at,
        app: s.apps
      })) || [];
    } catch (error: any) {
      console.error('❌ Get installed apps error:', error);
      throw new Error('Failed to get installed apps');
    }
  }

  async installApp(appId: string, companyId: string, planName = 'basic') {
    try {
      // Verificar que la app existe
      const app = await this.getApp(appId);
      
      // Verificar si ya está instalada
      const { data: existing } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select('id')
          .eq('company_id', companyId)
          .eq('app_id', appId)
          .single(),
        { data: null, error: null }
      );

      if (existing) {
        throw new Error('App already installed');
      }

      // Crear subscription
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .insert({
          company_id: companyId,
          app_id: appId,
          plan_name: planName,
          status: 'active',
          price_monthly: (app as any)?.base_price_monthly || 0,
          features: {},
          current_period_start: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Installation failed: ${error.message}`);
      }

      return {
        subscription,
        app,
        message: 'App installed successfully'
      };
    } catch (error: any) {
      console.error('❌ Install app error:', error);
      throw new Error(error.message || 'Failed to install app');
    }
  }

  async uninstallApp(appId: string, companyId: string) {
    try {
      const { data: subscription } = await safeSupabaseQuery(
        supabase
          .from('subscriptions')
          .select('id')
          .eq('company_id', companyId)
          .eq('app_id', appId)
          .single(),
        { data: null, error: null }
      );

      if (!subscription) {
        throw new Error('App not installed');
      }

      // Marcar como cancelada en lugar de eliminar
      const { error } = await supabase
        .from('subscriptions')
        .update({
          status: 'canceled',
          canceled_at: new Date().toISOString()
        })
        .eq('id', (subscription as any)?.id);

      if (error) {
        throw new Error(`Uninstall failed: ${error.message}`);
      }

      return {
        message: 'App uninstalled successfully'
      };
    } catch (error: any) {
      console.error('❌ Uninstall app error:', error);
      throw new Error(error.message || 'Failed to uninstall app');
    }
  }
}