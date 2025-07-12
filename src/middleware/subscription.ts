import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { getSupabase } from '../config/database';
import { CacheService } from '../config/redis';
import { ErrorCode } from '../constants/errors';
import { SubscriptionStatus, isActiveSubscription } from '../constants/apps';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { CACHE_KEYS } from '../constants';
import { 
  getTenantUsage,
  calculateTenantLimits,
  analyzeUsage
} from '../services/subscription.service';

const subscriptionCache = new CacheService('subscription', 300); // 5 minutos

export const checkSubscriptionAccess = (requiredApp: string) => {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) {
        res.status(400).json(createApiResponse(
          false,
          null,
          'Tenant no especificado',
          'Se requiere especificar el tenant para verificar suscripción',
          ErrorCode.VALIDATION_ERROR
        ));
        return;
      }

      // Intentar obtener de caché
      const cacheKey = CACHE_KEYS.SUBSCRIPTION(req.tenantId, requiredApp);
      const cachedSubscription = await subscriptionCache.get(cacheKey);
      
      if (cachedSubscription && isActiveSubscription(cachedSubscription.status)) {
        return next();
      }

      // Verificar suscripción en DB
      const supabase = getSupabase();
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('tenant_id', req.tenantId)
        .eq('app_id', requiredApp)
        .in('status', [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING])
        .single();

      if (!subscription) {
        logger.warn({
          tenantId: req.tenantId,
          requiredApp,
          requestId: req.requestId
        }, 'Subscription required but not found');
        
        res.status(403).json(createApiResponse(
          false,
          null,
          `Suscripción requerida para ${requiredApp}`,
          `No tienes acceso a ${requiredApp}. Suscríbete para continuar.`,
          ErrorCode.SUBSCRIPTION_REQUIRED,
          {
            app_id: requiredApp,
            action_required: 'subscribe',
            subscribe_url: `/api/subscriptions/plans?appId=${requiredApp}`
          }
        ));
        return;
      }

      // Verificar que no ha expirado
      const now = new Date();
      let expiresAt: Date | null = null;
      
      if (subscription.status === SubscriptionStatus.TRIALING && subscription.trial_ends_at) {
        expiresAt = new Date(subscription.trial_ends_at);
      } else if (subscription.current_period_end) {
        expiresAt = new Date(subscription.current_period_end);
      }

      if (expiresAt && expiresAt < now) {
        logger.warn({
          tenantId: req.tenantId,
          requiredApp,
          expiresAt,
          requestId: req.requestId
        }, 'Subscription expired');
        
        res.status(403).json(createApiResponse(
          false,
          null,
          `Suscripción a ${requiredApp} expirada`,
          `Tu suscripción expiró el ${expiresAt.toLocaleDateString()}`,
          ErrorCode.SUBSCRIPTION_EXPIRED,
          {
            app_id: requiredApp,
            expired_at: expiresAt.toISOString(),
            action_required: 'renew',
            renew_url: `/api/subscriptions/${subscription.id}/renew`
          }
        ));
        return;
      }

      // Guardar en caché
      await subscriptionCache.set(cacheKey, subscription);

      // Verificar límites de uso si es necesario
      const checkUsageLimits = req.headers['x-check-usage'] === 'true';
      if (checkUsageLimits) {
        const usage = await getTenantUsage(req.tenantId, requiredApp);
        const limits = await calculateTenantLimits(req.tenantId, requiredApp);
        const analysis = analyzeUsage(usage, limits);
        
        if (analysis.status === 'critical') {
          const criticalAlerts = analysis.alerts.filter(a => a.type === 'critical');
          
          if (criticalAlerts.length > 0) {
            logger.warn({
              tenantId: req.tenantId,
              requiredApp,
              criticalAlerts,
              requestId: req.requestId
            }, 'Usage limit exceeded');
            
            res.status(403).json(createApiResponse(
              false,
              null,
              'Límite de uso excedido',
              `Has excedido los límites de uso para ${requiredApp}`,
              ErrorCode.USAGE_LIMIT_EXCEEDED,
              {
                app_id: requiredApp,
                alerts: criticalAlerts,
                current_usage: usage,
                limits,
                action_required: 'upgrade',
                upgrade_url: `/api/subscriptions/${subscription.id}/upgrade`
              }
            ));
            return;
          }
        }

        // Añadir información de uso a los headers
        res.setHeader('X-Usage-Status', analysis.status);
        res.setHeader('X-Usage-Alerts', analysis.alerts.length.toString());
      }

      next();
    } catch (error: any) {
      logger.error({
        error: error.message,
        requiredApp,
        tenantId: req.tenantId,
        requestId: req.requestId
      }, 'Subscription check error');
      
      res.status(500).json(createApiResponse(
        false,
        null,
        'Error al verificar suscripción',
        'Error interno al verificar el acceso a la aplicación',
        ErrorCode.INTERNAL_ERROR
      ));
    }
  };
};

// Requerir suscripción activa (no trial)
export const requireSubscription = (requiredApp: string) => {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Primero verificar acceso básico
      await checkSubscriptionAccess(requiredApp)(req, res, () => {});
      
      // Si ya respondió, terminar
      if (res.headersSent) {
        return;
      }

      // Verificar que no es trial
      const supabase = getSupabase();
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('status, trial_ends_at')
        .eq('tenant_id', req.tenantId!)
        .eq('app_id', requiredApp)
        .single();

      if (subscription?.status === SubscriptionStatus.TRIALING) {
        const trialEndsAt = new Date(subscription.trial_ends_at!);
        const daysRemaining = Math.ceil(
          (trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );

        res.status(402).json(createApiResponse(
          false,
          null,
          'Suscripción de pago requerida',
          `Esta función requiere una suscripción de pago. Tu período de prueba termina en ${daysRemaining} días.`,
          ErrorCode.PAYMENT_REQUIRED,
          {
            app_id: requiredApp,
            trial_ends_at: trialEndsAt.toISOString(),
            days_remaining: daysRemaining,
            action_required: 'upgrade',
            upgrade_url: `/api/subscriptions/${subscription.id}/upgrade`
          }
        ));
        return;
      }

      next();
    } catch (error: any) {
      logger.error({
        error: error.message,
        requiredApp,
        tenantId: req.tenantId,
        requestId: req.requestId
      }, 'Require subscription error');
      
      res.status(500).json(createApiResponse(
        false,
        null,
        'Error al verificar suscripción',
        'Error interno al verificar la suscripción',
        ErrorCode.INTERNAL_ERROR
      ));
    }
  };
};

// Verificar feature específico de una suscripción
export const requireFeature = (appId: string, feature: string) => {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      // Primero verificar acceso a la app
      await checkSubscriptionAccess(appId)(req, res, () => {});
      
      if (res.headersSent) {
        return;
      }

      // Obtener features de la suscripción
      const supabase = getSupabase();
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('features')
        .eq('tenant_id', req.tenantId!)
        .eq('app_id', appId)
        .single();

      const features = subscription?.features as any;
      const enabledModules = features?.enabled_modules || [];

      if (!enabledModules.includes(feature)) {
        res.status(403).json(createApiResponse(
          false,
          null,
          'Feature no disponible',
          `El módulo '${feature}' no está disponible en tu plan actual`,
          ErrorCode.FORBIDDEN,
          {
            required_feature: feature,
            available_features: enabledModules,
            action_required: 'upgrade',
            upgrade_url: `/api/subscriptions/upgrade?feature=${feature}`
          }
        ));
        return;
      }

      next();
    } catch (error: any) {
      logger.error({
        error: error.message,
        appId,
        feature,
        tenantId: req.tenantId,
        requestId: req.requestId
      }, 'Require feature error');
      
      res.status(500).json(createApiResponse(
        false,
        null,
        'Error al verificar feature',
        'Error interno al verificar el acceso al módulo',
    ErrorCode.INTERNAL_ERROR
));
}
};
};
