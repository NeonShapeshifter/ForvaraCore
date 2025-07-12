import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { subscriptionService } from './subscription.service';
import { tenantService } from './tenant.service';
import { notificationService } from './notification.service';
import { activityService } from './activity.service';
import { 
  NotFoundError, 
  ValidationError,
  AuthorizationError,
  App,
  AppInstallation,
  AppPermission,
  PaginatedResponse
} from '../types';
import { ACTIVITY_ACTIONS } from '../constants';

// Lazy initialization to avoid circular dependencies

interface AppFilters {
  category?: string;
  status?: 'active' | 'inactive' | 'development';
  featured?: boolean;
  search?: string;
  tags?: string[];
}

interface InstallAppParams {
  tenantId: string;
  appId: string;
  userId: string;
  config?: Record<string, any>;
  autoSubscribe?: boolean;
  planId?: string;
}

interface AppMetrics {
  total_installs: number;
  active_installs: number;
  average_rating: number;
  total_reviews: number;
  revenue_monthly: number;
  retention_rate: number;
}

interface AppPermissionRequest {
  appId: string;
  tenantId: string;
  permissions: string[];
  reason?: string;
  requestedBy: string;
}

class AppService {
  private getSupabase() {
    return getSupabase();
  }
  
  private getRedis() {
    return getRedis();
  }

  /**
   * Obtener todas las aplicaciones disponibles (marketplace)
   */
  async getAllApps(
    filters: AppFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<App>> {
    return this.getAvailableApps(filters, page, limit);
  }

  /**
   * Obtener todas las aplicaciones disponibles (marketplace)
   */
  async getAvailableApps(
    filters: AppFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<App>> {
    try {
      const { category, status = 'active', featured, search, tags } = filters;
      const offset = (page - 1) * limit;

      let query = this.getSupabase()
        .from('apps')
        .select(`
          *,
          app_categories (
            id,
            name,
            slug
          ),
          subscription_plans (
            id,
            name,
            display_name,
            price_monthly,
            price_yearly,
            currency,
            features,
            has_trial,
            trial_days
          )
        `)
        .eq('status', status)
        .eq('is_public', true)
        .order('featured', { ascending: false })
        .order('name', { ascending: true })
        .range(offset, offset + limit - 1);

      // Aplicar filtros
      if (category) {
        query = query.eq('category_id', category);
      }

      if (featured !== undefined) {
        query = query.eq('featured', featured);
      }

      if (search) {
        query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,tags.cs.{${search}}`);
      }

      if (tags && tags.length > 0) {
        query = query.contains('tags', tags);
      }

      const { data: apps, error, count } = await query;

      if (error) throw error;

      // Enriquecer con métricas básicas
      const enrichedApps = await Promise.all(
        (apps || []).map(async (app) => {
          const [metrics, totalInstalls] = await Promise.all([
            this.getAppMetrics(app.id),
            this.getAppInstallCount(app.id)
          ]);

          return {
            ...app,
            metrics: {
              total_installs: totalInstalls,
              average_rating: metrics.average_rating,
              total_reviews: metrics.total_reviews
            }
          };
        })
      );

      return {
        data: enrichedApps,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, filters }, 'Get available apps failed');
      throw error;
    }
  }

  /**
   * Obtener aplicación por ID
   */
  async getAppById(appId: string, includeMetrics: boolean = true): Promise<App | null> {
    try {
      const { data: app, error } = await this.getSupabase()
        .from('apps')
        .select(`
          *,
          app_categories (
            id,
            name,
            slug,
            description
          ),
          subscription_plans (
            id,
            name,
            display_name,
            description,
            price_monthly,
            price_yearly,
            currency,
            features,
            has_trial,
            trial_days,
            stripe_price_id,
            active
          ),
          addons (
            id,
            name,
            display_name,
            description,
            price_monthly,
            unit_label,
            features,
            active
          )
        `)
        .eq('id', appId)
        .single();

      if (error) throw error;
      if (!app) return null;

      // Enriquecer con métricas si se solicita
      if (includeMetrics) {
        const [metrics, screenshots, reviews] = await Promise.all([
          this.getAppMetrics(appId),
          this.getAppScreenshots(appId),
          this.getAppReviews(appId, 1, 5)
        ]);

        return {
          ...app,
          metrics,
          screenshots,
          recent_reviews: reviews.data
        };
      }

      return app;
    } catch (error) {
      logger.error({ error, appId }, 'Get app by ID failed');
      throw error;
    }
  }

  /**
   * Instalar aplicación en tenant
   */
  async installApp(params: InstallAppParams): Promise<AppInstallation> {
    try {
      const { tenantId, appId, userId, config = {}, autoSubscribe = false, planId } = params;

      // Verificar que la app existe y está activa
      const app = await this.getAppById(appId, false);
      if (!app || app.status !== 'active') {
        throw new NotFoundError('Aplicación no disponible');
      }

      // Verificar que el tenant existe
      const tenant = await tenantService.getTenantById(tenantId);
      if (!tenant) {
        throw new NotFoundError('Tenant');
      }

      // Verificar que no esté ya instalada
      const existingInstallation = await this.getAppInstallation(tenantId, appId);
      if (existingInstallation) {
        throw new ValidationError('La aplicación ya está instalada');
      }

      // Verificar permisos del usuario
      const hasPermission = await tenantService.hasPermission(
        tenantId, 
        userId, 
        'apps.install'
      );
      if (!hasPermission) {
        throw new AuthorizationError('No tienes permisos para instalar aplicaciones');
      }

      // Crear instalación
      const installation = await this.createAppInstallation({
        tenantId,
        appId,
        userId,
        config,
        status: 'installing'
      });

      // Si auto-subscribe está habilitado, crear suscripción
      if (autoSubscribe && planId) {
        try {
          await subscriptionService.createSubscription({
            tenantId,
            planId,
            paymentMethodId: '', // Se manejará en el frontend
            metadata: {
              source: 'app_installation',
              installation_id: installation.id
            }
          });
        } catch (subscriptionError) {
          logger.warn({ 
            error: subscriptionError, 
            tenantId, 
            appId, 
            planId 
          }, 'Auto-subscription failed during app installation');
        }
      }

      // Aplicar configuración inicial si existe
      if (Object.keys(config).length > 0) {
        await this.updateAppConfig(installation.id, config);
      }

      // Marcar como instalada
      await this.updateInstallationStatus(installation.id, 'installed');

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: userId,
        action: ACTIVITY_ACTIONS.APP_INSTALLED,
        resource_type: 'app',
        resource_id: appId,
        details: {
          app_name: app.name,
          installation_id: installation.id,
          auto_subscribe: autoSubscribe,
          plan_id: planId
        }
      });

      // Notificar a admins del tenant
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'app_installed',
        title: 'Nueva aplicación instalada',
        message: `${app.name} ha sido instalada exitosamente`,
        data: {
          app_id: appId,
          app_name: app.name,
          installation_id: installation.id,
          installed_by: userId
        }
      });

      logger.info({ 
        tenantId, 
        appId, 
        userId, 
        installationId: installation.id 
      }, 'App installed successfully');

      return installation;
    } catch (error) {
      logger.error({ error, params }, 'Install app failed');
      throw error;
    }
  }

  /**
   * Desinstalar aplicación
   */
  async uninstallApp(
    tenantId: string, 
    appId: string, 
    userId: string,
    reason?: string
  ): Promise<void> {
    try {
      // Verificar instalación
      const installation = await this.getAppInstallation(tenantId, appId);
      if (!installation) {
        throw new NotFoundError('Aplicación no instalada');
      }

      // Verificar permisos
      const hasPermission = await tenantService.hasPermission(
        tenantId, 
        userId, 
        'apps.uninstall'
      );
      if (!hasPermission) {
        throw new AuthorizationError('No tienes permisos para desinstalar aplicaciones');
      }

      // Obtener información de la app
      const app = await this.getAppById(appId, false);

      // Cancelar suscripciones activas relacionadas
      const subscriptions = await subscriptionService.getTenantSubscriptions(tenantId);
      for (const subscription of subscriptions) {
        if (subscription.app_id === appId && subscription.status === 'active') {
          await subscriptionService.cancelSubscription(
            subscription.id,
            false, // No cancelar inmediatamente
            'app_uninstalled'
          );
        }
      }

      // Marcar como desinstalada (soft delete)
      await this.getSupabase()
        .from('app_installations')
        .update({
          status: 'uninstalled',
          uninstalled_at: new Date().toISOString(),
          uninstalled_by: userId,
          uninstall_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', installation.id);

      // Remover configuraciones y datos (según política de la app)
      await this.cleanupAppData(installation.id, tenantId, appId);

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: userId,
        action: ACTIVITY_ACTIONS.APP_UNINSTALLED,
        resource_type: 'app',
        resource_id: appId,
        details: {
          app_name: app?.name,
          installation_id: installation.id,
          reason
        }
      });

      // Notificar a admins del tenant
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'app_uninstalled',
        title: 'Aplicación desinstalada',
        message: `${app?.name} ha sido desinstalada`,
        data: {
          app_id: appId,
          app_name: app?.name,
          installation_id: installation.id,
          uninstalled_by: userId,
          reason
        }
      });

      logger.info({ 
        tenantId, 
        appId, 
        userId, 
        installationId: installation.id 
      }, 'App uninstalled successfully');
    } catch (error) {
      logger.error({ error, tenantId, appId, userId }, 'Uninstall app failed');
      throw error;
    }
  }

  /**
   * Obtener planes de una aplicación
   */
  async getAppPlans(appId: string): Promise<any[]> {
    try {
      const { data: plans, error } = await this.getSupabase()
        .from('subscription_plans')
        .select('*')
        .eq('app_id', appId)
        .eq('active', true)
        .order('price_monthly', { ascending: true });

      if (error) {
        logger.error({ error, appId }, 'Failed to get app plans');
        throw error;
      }

      return plans || [];
    } catch (error) {
      logger.error({ error, appId }, 'Get app plans failed');
      throw error;
    }
  }

  /**
   * Obtener addons de una aplicación
   */
  async getAppAddons(appId: string): Promise<any[]> {
    try {
      const { data: addons, error } = await this.getSupabase()
        .from('addons')
        .select('*')
        .eq('app_id', appId)
        .eq('active', true)
        .order('price_monthly', { ascending: true });

      if (error) {
        logger.error({ error, appId }, 'Failed to get app addons');
        throw error;
      }

      return addons || [];
    } catch (error) {
      logger.error({ error, appId }, 'Get app addons failed');
      throw error;
    }
  }

  /**
   * Obtener aplicaciones instaladas de un tenant
   */
  async getInstalledApps(
    tenantId: string,
    includeInactive: boolean = false
  ): Promise<AppInstallation[]> {
    try {
      let query = this.getSupabase()
        .from('app_installations')
        .select(`
          *,
          apps (
            id,
            name,
            display_name,
            description,
            icon_url,
            app_url,
            version,
            category_id,
            status,
            app_categories (
              name,
              slug
            )
          )
        `)
        .eq('tenant_id', tenantId)
        .order('installed_at', { ascending: false });

      if (!includeInactive) {
        query = query.eq('status', 'installed');
      }

      const { data: installations, error } = await query;

      if (error) throw error;

      // Enriquecer con información de suscripciones
      const enrichedInstallations = await Promise.all(
        (installations || []).map(async (installation) => {
          const subscription = await subscriptionService.getActiveSubscription(
            tenantId,
            installation.app_id
          );

          return {
            ...installation,
            subscription,
            has_active_subscription: !!subscription
          };
        })
      );

      return enrichedInstallations;
    } catch (error) {
      logger.error({ error, tenantId }, 'Get installed apps failed');
      throw error;
    }
  }

  /**
   * Obtener configuración de una app instalada
   */
  async getAppConfig(tenantId: string, appId: string): Promise<Record<string, any>> {
    try {
      const installation = await this.getAppInstallation(tenantId, appId);
      if (!installation) {
        throw new NotFoundError('Aplicación no instalada');
      }

      return installation.config || {};
    } catch (error) {
      logger.error({ error, tenantId, appId }, 'Get app config failed');
      throw error;
    }
  }

  /**
   * Actualizar configuración de una app instalada
   */
  async updateAppConfig(
    installationId: string,
    config: Record<string, any>
  ): Promise<void> {
    try {
      const { error } = await this.getSupabase()
        .from('app_installations')
        .update({
          config,
          updated_at: new Date().toISOString()
        })
        .eq('id', installationId);

      if (error) throw error;

      logger.info({ installationId }, 'App config updated successfully');
    } catch (error) {
      logger.error({ error, installationId }, 'Update app config failed');
      throw error;
    }
  }

  /**
   * Obtener categorías de aplicaciones
   */
  async getAppCategories(): Promise<any[]> {
    try {
      const cacheKey = 'app-categories';
      const cached = await this.getRedis().get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const { data: categories, error } = await this.getSupabase()
        .from('app_categories')
        .select('*')
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) throw error;

      // Cachear por 1 hora
      await this.getRedis().setex(cacheKey, 3600, JSON.stringify(categories || []));

      return categories || [];
    } catch (error) {
      logger.error({ error }, 'Get app categories failed');
      throw error;
    }
  }

  /**
   * Buscar aplicaciones
   */
  async searchApps(
    query: string,
    filters: AppFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<App>> {
    try {
      return await this.getAvailableApps(
        { ...filters, search: query },
        page,
        limit
      );
    } catch (error) {
      logger.error({ error, query, filters }, 'Search apps failed');
      throw error;
    }
  }

  /**
   * Obtener aplicaciones destacadas
   */
  async getFeaturedApps(limit: number = 6): Promise<App[]> {
    try {
      const cacheKey = `featured-apps:${limit}`;
      const cached = await this.getRedis().get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      const { data: apps, error } = await this.getSupabase()
        .from('apps')
        .select(`
          *,
          app_categories (
            id,
            name,
            slug
          ),
          subscription_plans (
            id,
            name,
            display_name,
            price_monthly,
            price_yearly,
            currency,
            has_trial,
            trial_days
          )
        `)
        .eq('status', 'active')
        .eq('is_public', true)
        .eq('featured', true)
        .order('featured_order', { ascending: true })
        .order('name', { ascending: true })
        .limit(limit);

      if (error) throw error;

      // Cachear por 30 minutos
      await this.getRedis().setex(cacheKey, 1800, JSON.stringify(apps || []));

      return apps || [];
    } catch (error) {
      logger.error({ error, limit }, 'Get featured apps failed');
      throw error;
    }
  }

  /**
   * Verificar si una app está instalada
   */
  async isAppInstalled(tenantId: string, appId: string): Promise<boolean> {
    try {
      const installation = await this.getAppInstallation(tenantId, appId);
      return installation !== null && installation.status === 'installed';
    } catch (error) {
      logger.error({ error, tenantId, appId }, 'Check app installation failed');
      return false;
    }
  }

  /**
   * Generar URL de acceso a la aplicación
   */
  async generateAppAccessUrl(
    tenantId: string,
    appId: string,
    userId: string
  ): Promise<string> {
    try {
      const [installation, app] = await Promise.all([
        this.getAppInstallation(tenantId, appId),
        this.getAppById(appId, false)
      ]);

      if (!installation || installation.status !== 'installed') {
        throw new NotFoundError('Aplicación no instalada');
      }

      if (!app || app.status !== 'active') {
        throw new NotFoundError('Aplicación no disponible');
      }

      // Generar token de acceso temporal
      const accessToken = await this.generateAppAccessToken(tenantId, appId, userId);

      // Construir URL con token
      const baseUrl = app.app_url;
      const separator = baseUrl.includes('?') ? '&' : '?';
      
      return `${baseUrl}${separator}access_token=${accessToken}&tenant_id=${tenantId}&user_id=${userId}`;
    } catch (error) {
      logger.error({ error, tenantId, appId, userId }, 'Generate app access URL failed');
      throw error;
    }
  }

  // Métodos auxiliares privados

  private async getAppInstallation(tenantId: string, appId: string): Promise<AppInstallation | null> {
    const { data: installation } = await this.getSupabase()
      .from('app_installations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('app_id', appId)
      .neq('status', 'uninstalled')
      .single();

    return installation;
  }

  private async createAppInstallation(params: {
    tenantId: string;
    appId: string;
    userId: string;
    config: Record<string, any>;
    status: string;
  }): Promise<AppInstallation> {
    const { tenantId, appId, userId, config, status } = params;

    const { data: installation, error } = await this.getSupabase()
      .from('app_installations')
      .insert({
        id: uuidv4(),
        tenant_id: tenantId,
        app_id: appId,
        installed_by: userId,
        status,
        config,
        installed_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return installation;
  }

  private async updateInstallationStatus(
    installationId: string,
    status: string
  ): Promise<void> {
    await this.getSupabase()
      .from('app_installations')
      .update({
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', installationId);
  }

  private async getAppMetrics(appId: string): Promise<AppMetrics> {
    try {
      // Obtener métricas desde vistas materializadas
      const { data: metrics } = await this.getSupabase()
        .from('app_metrics')
        .select('*')
        .eq('app_id', appId)
        .single();

      return metrics || {
        total_installs: 0,
        active_installs: 0,
        average_rating: 0,
        total_reviews: 0,
        revenue_monthly: 0,
        retention_rate: 0
      };
    } catch (error) {
      logger.error({ error, appId }, 'Get app metrics failed');
      return {
        total_installs: 0,
        active_installs: 0,
        average_rating: 0,
        total_reviews: 0,
        revenue_monthly: 0,
        retention_rate: 0
      };
    }
  }

  private async getAppInstallCount(appId: string): Promise<number> {
    const { count, error } = await this.getSupabase()
      .from('app_installations')
      .select('id', { count: 'exact' })
      .eq('app_id', appId)
      .eq('status', 'installed');

    if (error) {
      logger.error({ error, appId }, 'Get app install count failed');
      return 0;
    }

    return count || 0;
  }

  private async getAppScreenshots(appId: string): Promise<string[]> {
    const { data: screenshots } = await this.getSupabase()
      .from('app_screenshots')
      .select('url')
      .eq('app_id', appId)
      .order('sort_order', { ascending: true });

    return screenshots?.map(s => s.url) || [];
  }

  private async getAppReviews(
    appId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<PaginatedResponse<any>> {
    const offset = (page - 1) * limit;

    const { data: reviews, error, count } = await this.getSupabase()
      .from('app_reviews')
      .select(`
        *,
        users (
          id,
          email,
          profile (
            full_name,
            avatar_url
          )
        )
      `)
      .eq('app_id', appId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return {
      data: reviews || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    };
  }

  private async cleanupAppData(
    installationId: string,
    tenantId: string,
    appId: string
  ): Promise<void> {
    try {
      // Remover configuraciones específicas de la app
      await this.getSupabase()
        .from('app_configurations')
        .delete()
        .eq('installation_id', installationId);

      // Remover datos de la app (según política de retención)
      await this.getSupabase()
        .from('app_data')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('app_id', appId);

      // Remover permisos específicos de la app
      await this.getSupabase()
        .from('app_permissions')
        .delete()
        .eq('installation_id', installationId);

      logger.info({ installationId, tenantId, appId }, 'App data cleaned up');
    } catch (error) {
      logger.error({ error, installationId, tenantId, appId }, 'App data cleanup failed');
    }
  }

  private async generateAppAccessToken(
    tenantId: string,
    appId: string,
    userId: string
  ): Promise<string> {
    // Generar token JWT temporal para acceso a la app
    // Este token será válido por 1 hora y contiene información del tenant y usuario
    const payload = {
      tenant_id: tenantId,
      app_id: appId,
      user_id: userId,
      issued_at: Date.now(),
      expires_at: Date.now() + (60 * 60 * 1000) // 1 hora
    };

    // En una implementación real, usar JWT con clave secreta
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}

export const appService = new AppService();