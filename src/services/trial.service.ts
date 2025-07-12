import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { subscriptionService } from './subscription.service';
import { billingService } from './billing.service';
import { tenantService } from './tenant.service';
import { notificationService } from './notification.service';
import { emailService } from './email.service';
import { activityService } from './activity.service';
import { 
  NotFoundError, 
  ValidationError,
  Subscription,
  SubscriptionPlan
} from '../types';
import { ACTIVITY_ACTIONS } from '../constants';

// const supabase = getSupabase(); // Moved to lazy loading
const redis = getRedis();

interface TrialConversionOffer {
  id: string;
  subscription_id: string;
  plan_id: string;
  discount_percentage: number;
  valid_until: Date;
  offer_code: string;
  created_at: Date;
  used_at?: Date;
  conversion_successful: boolean;
}

interface TrialUsageAnalytics {
  subscription_id: string;
  days_used: number;
  days_remaining: number;
  usage_percentage: number;
  feature_usage: {
    feature_key: string;
    usage_count: number;
    limit: number;
    usage_percentage: number;
  }[];
  engagement_score: number;
  conversion_probability: number;
}

interface ConversionCampaign {
  id: string;
  name: string;
  app_id: string;
  trigger_days_before_end: number;
  discount_percentage: number;
  email_template: string;
  notification_template: string;
  active: boolean;
  success_rate: number;
}

class TrialService {
  /**
   * Obtener trials que están por expirar
   */
  async getExpiringTrials(daysAhead: number = 3): Promise<Subscription[]> {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + daysAhead);

      const { data: trials, error } = await supabase
        .from('subscriptions')
        .select(`
          *,
          subscription_plans (
            id,
            name,
            display_name,
            app_id,
            price_monthly,
            price_yearly
          ),
          tenants (
            id,
            name,
            razon_social,
            email,
            owner_id
          )
        `)
        .eq('status', 'trialing')
        .lte('trial_ends_at', targetDate.toISOString())
        .gte('trial_ends_at', new Date().toISOString());

      if (error) throw error;

      return trials || [];
    } catch (error) {
      logger.error({ error, daysAhead }, 'Get expiring trials failed');
      throw error;
    }
  }

  /**
   * Obtener analíticas de uso del trial
   */
  async getTrialUsageAnalytics(subscriptionId: string): Promise<TrialUsageAnalytics> {
    try {
      const subscription = await this.getTrialSubscription(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción trial');
      }

      const trialStart = new Date(subscription.current_period_start);
      const trialEnd = new Date(subscription.trial_ends_at!);
      const now = new Date();

      // Calcular días
      const totalTrialDays = Math.ceil((trialEnd.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysUsed = Math.ceil((now.getTime() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      const usagePercentage = Math.min(100, (daysUsed / totalTrialDays) * 100);

      // Obtener uso de features
      const { data: featureUsage } = await supabase
        .from('tenant_features')
        .select(`
          feature_key,
          value,
          current_usage,
          features (
            name,
            type
          )
        `)
        .eq('tenant_id', subscription.tenant_id)
        .eq('is_active', true);

      const featureUsageAnalytics = (featureUsage || []).map(feature => {
        const limit = feature.features.type === 'limit' ? parseInt(feature.value) : 100;
        const usage = feature.current_usage || 0;
        const usagePercentage = limit > 0 ? (usage / limit) * 100 : 0;

        return {
          feature_key: feature.feature_key,
          usage_count: usage,
          limit,
          usage_percentage: Math.min(100, usagePercentage)
        };
      });

      // Calcular score de engagement
      const engagementScore = await this.calculateEngagementScore(subscription.tenant_id, subscription.app_id);

      // Calcular probabilidad de conversión
      const conversionProbability = await this.calculateConversionProbability({
        usagePercentage,
        engagementScore,
        featureUsage: featureUsageAnalytics,
        daysRemaining
      });

      return {
        subscription_id: subscriptionId,
        days_used: daysUsed,
        days_remaining: daysRemaining,
        usage_percentage: Math.round(usagePercentage * 100) / 100,
        feature_usage: featureUsageAnalytics,
        engagement_score: Math.round(engagementScore * 100) / 100,
        conversion_probability: Math.round(conversionProbability * 100) / 100
      };
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Get trial usage analytics failed');
      throw error;
    }
  }

  /**
   * Crear oferta de conversión personalizada
   */
  async createConversionOffer(
    subscriptionId: string,
    campaignId?: string
  ): Promise<TrialConversionOffer> {
    try {
      const subscription = await this.getTrialSubscription(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción trial');
      }

      // Obtener campaña de conversión o usar configuración por defecto
      let campaign: ConversionCampaign | null = null;
      if (campaignId) {
        const { data: campaignData } = await supabase
          .from('conversion_campaigns')
          .select('*')
          .eq('id', campaignId)
          .eq('active', true)
          .single();

        campaign = campaignData;
      }

      // Calcular descuento basado en analytics
      const analytics = await this.getTrialUsageAnalytics(subscriptionId);
      const discount = campaign?.discount_percentage || this.calculatePersonalizedDiscount(analytics);

      // Crear código de oferta único
      const offerCode = this.generateOfferCode(subscription.tenant_id);

      // Calcular fecha de validez (hasta final del trial + 7 días de gracia)
      const validUntil = new Date(subscription.trial_ends_at!);
      validUntil.setDate(validUntil.getDate() + 7);

      // Crear oferta en base de datos
      const { data: offer, error } = await supabase
        .from('trial_conversion_offers')
        .insert({
          id: uuidv4(),
          subscription_id: subscriptionId,
          plan_id: subscription.plan_id,
          discount_percentage: discount,
          valid_until: validUntil.toISOString(),
          offer_code: offerCode,
          campaign_id: campaignId,
          analytics: analytics,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Registrar actividad
      await activityService.log({
        tenant_id: subscription.tenant_id,
        user_id: subscription.tenants.owner_id,
        action: ACTIVITY_ACTIONS.TRIAL_CONVERSION_OFFER_CREATED,
        resource_type: 'subscription',
        resource_id: subscriptionId,
        details: {
          offer_id: offer.id,
          discount_percentage: discount,
          offer_code: offerCode,
          conversion_probability: analytics.conversion_probability
        }
      });

      logger.info({ 
        subscriptionId, 
        offerId: offer.id,
        discount,
        offerCode 
      }, 'Trial conversion offer created');

      return offer;
    } catch (error) {
      logger.error({ error, subscriptionId, campaignId }, 'Create conversion offer failed');
      throw error;
    }
  }

  /**
   * Enviar campaña de conversión
   */
  async sendConversionCampaign(subscriptionId: string, campaignId?: string): Promise<void> {
    try {
      const subscription = await this.getTrialSubscription(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción trial');
      }

      // Crear oferta de conversión
      const offer = await this.createConversionOffer(subscriptionId, campaignId);

      // Obtener información del plan
      const plan = subscription.subscription_plans;

      // Enviar notificación in-app
      await notificationService.notifyTenantAdmins(subscription.tenant_id, {
        type: 'trial_conversion_offer',
        title: 'Oferta especial para tu trial',
        message: `Obtén ${offer.discount_percentage}% de descuento al convertir tu trial de ${plan.display_name}`,
        priority: 'high',
        action_url: `/billing/convert-trial?offer=${offer.offer_code}`,
        action_label: 'Ver oferta',
        expires_at: offer.valid_until,
        data: {
          subscription_id: subscriptionId,
          offer_id: offer.id,
          discount_percentage: offer.discount_percentage,
          offer_code: offer.offer_code,
          plan_name: plan.display_name
        }
      });

      // Enviar email personalizado
      await this.sendConversionEmail(subscription, offer);

      // Actualizar métricas de campaña
      if (campaignId) {
        await this.updateCampaignMetrics(campaignId, 'sent');
      }

      logger.info({ 
        subscriptionId, 
        offerId: offer.id,
        campaignId 
      }, 'Conversion campaign sent');
    } catch (error) {
      logger.error({ error, subscriptionId, campaignId }, 'Send conversion campaign failed');
      throw error;
    }
  }

  /**
   * Convertir trial usando oferta
   */
  async convertTrialWithOffer(
    offerCode: string,
    paymentMethodId: string,
    billingCycle: 'monthly' | 'yearly' = 'monthly'
  ): Promise<Subscription> {
    try {
      // Obtener y validar oferta
      const { data: offer, error: offerError } = await supabase
        .from('trial_conversion_offers')
        .select(`
          *,
          subscriptions (
            *,
            subscription_plans (*),
            tenants (*)
          )
        `)
        .eq('offer_code', offerCode)
        .eq('conversion_successful', false)
        .gte('valid_until', new Date().toISOString())
        .single();

      if (offerError || !offer) {
        throw new ValidationError('Código de oferta inválido o expirado');
      }

      const subscription = offer.subscriptions;

      // Verificar que sigue siendo trial
      if (subscription.status !== 'trialing') {
        throw new ValidationError('La suscripción ya no está en período de prueba');
      }

      // Crear suscripción de pago con descuento
      const convertedSubscription = await this.createPaidSubscriptionFromTrial(
        subscription,
        paymentMethodId,
        billingCycle,
        offer.discount_percentage
      );

      // Marcar oferta como usada
      await supabase
        .from('trial_conversion_offers')
        .update({
          used_at: new Date().toISOString(),
          conversion_successful: true,
          converted_subscription_id: convertedSubscription.id
        })
        .eq('id', offer.id);

      // Cancelar suscripción trial original
      await supabase
        .from('subscriptions')
        .update({
          status: 'canceled',
          ends_at: new Date().toISOString(),
          cancel_reason: 'converted_to_paid',
          updated_at: new Date().toISOString()
        })
        .eq('id', subscription.id);

      // Registrar conversión exitosa
      await activityService.log({
        tenant_id: subscription.tenant_id,
        user_id: subscription.tenants.owner_id,
        action: ACTIVITY_ACTIONS.TRIAL_CONVERTED,
        resource_type: 'subscription',
        resource_id: convertedSubscription.id,
        details: {
          original_subscription_id: subscription.id,
          offer_id: offer.id,
          discount_percentage: offer.discount_percentage,
          billing_cycle: billingCycle,
          offer_code: offerCode
        }
      });

      // Notificar conversión exitosa
      await notificationService.notifyTenantAdmins(subscription.tenant_id, {
        type: 'trial_converted',
        title: 'Trial convertido exitosamente',
        message: `Tu trial de ${subscription.subscription_plans.display_name} ha sido convertido a suscripción de pago`,
        data: {
          subscription_id: convertedSubscription.id,
          plan_name: subscription.subscription_plans.display_name,
          discount_applied: offer.discount_percentage,
          billing_cycle: billingCycle
        }
      });

      // Enviar email de confirmación
      await this.sendConversionConfirmationEmail(subscription, convertedSubscription, offer);

      // Actualizar métricas de campaña
      if (offer.campaign_id) {
        await this.updateCampaignMetrics(offer.campaign_id, 'converted');
      }

      logger.info({ 
        offerCode,
        originalSubscriptionId: subscription.id,
        convertedSubscriptionId: convertedSubscription.id,
        discount: offer.discount_percentage
      }, 'Trial converted successfully with offer');

      return convertedSubscription;
    } catch (error) {
      logger.error({ error, offerCode }, 'Convert trial with offer failed');
      throw error;
    }
  }

  /**
   * Procesar trials que expiran hoy
   */
  async processExpiringTrials(): Promise<void> {
    try {
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      const expiringTrials = await this.getExpiringTrials(0);

      logger.info({ count: expiringTrials.length }, 'Processing expiring trials');

      for (const trial of expiringTrials) {
        try {
          // Crear oferta de última oportunidad si no existe
          const existingOffer = await this.getActiveOffer(trial.id);
          if (!existingOffer) {
            await this.createConversionOffer(trial.id);
          }

          // Enviar notificación de expiración
          await this.sendTrialExpirationNotification(trial);

          // Programar cancelación automática para mañana
          await this.scheduleTrialCancellation(trial.id);

        } catch (trialError) {
          logger.error({ 
            error: trialError, 
            subscriptionId: trial.id 
          }, 'Process individual expiring trial failed');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Process expiring trials failed');
      throw error;
    }
  }

  /**
   * Cancelar trials expirados
   */
  async cancelExpiredTrials(): Promise<void> {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(23, 59, 59, 999);

      const { data: expiredTrials, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('status', 'trialing')
        .lte('trial_ends_at', yesterday.toISOString());

      if (error) throw error;

      logger.info({ count: expiredTrials?.length || 0 }, 'Processing expired trials');

      for (const trial of expiredTrials || []) {
        try {
          await billingService.cancelSubscription(trial.id, {
            immediate: true,
            reason: 'trial_expired',
            canceled_by: 'system'
          });

          // Remover features del plan
          await subscriptionService.removePlanFeatures(trial.tenant_id, trial.plan_id);

          logger.info({ subscriptionId: trial.id }, 'Expired trial canceled');
        } catch (cancelError) {
          logger.error({ 
            error: cancelError, 
            subscriptionId: trial.id 
          }, 'Cancel expired trial failed');
        }
      }
    } catch (error) {
      logger.error({ error }, 'Cancel expired trials failed');
      throw error;
    }
  }

  // Métodos auxiliares privados

  private async getTrialSubscription(subscriptionId: string): Promise<any> {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select(`
        *,
        subscription_plans (*),
        tenants (*)
      `)
      .eq('id', subscriptionId)
      .eq('status', 'trialing')
      .single();

    return subscription;
  }

  private async calculateEngagementScore(tenantId: string, appId: string): Promise<number> {
    try {
      // Obtener actividades recientes del tenant en la app
      const { data: activities, error } = await supabase
        .from('activities')
        .select('action, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const activityCount = activities?.length || 0;
      const uniqueDays = new Set(
        activities?.map(a => new Date(a.created_at).toDateString()) || []
      ).size;

      // Score basado en cantidad de actividades y días únicos de uso
      const activityScore = Math.min(100, activityCount * 2);
      const consistencyScore = Math.min(100, uniqueDays * 15);

      return (activityScore + consistencyScore) / 2;
    } catch (error) {
      logger.error({ error, tenantId, appId }, 'Calculate engagement score failed');
      return 0;
    }
  }

  private calculateConversionProbability(data: {
    usagePercentage: number;
    engagementScore: number;
    featureUsage: any[];
    daysRemaining: number;
  }): number {
    const { usagePercentage, engagementScore, featureUsage, daysRemaining } = data;

    // Factores que influyen en la probabilidad de conversión
    let probability = 0;

    // Factor de uso temporal (más uso = mayor probabilidad)
    probability += Math.min(40, usagePercentage * 0.4);

    // Factor de engagement
    probability += Math.min(30, engagementScore * 0.3);

    // Factor de uso de features
    const avgFeatureUsage = featureUsage.length > 0 
      ? featureUsage.reduce((sum, f) => sum + f.usage_percentage, 0) / featureUsage.length
      : 0;
    probability += Math.min(20, avgFeatureUsage * 0.2);

    // Factor de urgencia (menos días = mayor urgencia)
    const urgencyScore = daysRemaining <= 3 ? 10 : daysRemaining <= 7 ? 5 : 0;
    probability += urgencyScore;

    return Math.min(100, Math.max(0, probability));
  }

  private calculatePersonalizedDiscount(analytics: TrialUsageAnalytics): number {
    const { conversion_probability, engagement_score, usage_percentage } = analytics;

    // Descuento base según probabilidad de conversión
    let discount = 0;

    if (conversion_probability >= 70) {
      discount = 10; // Alta probabilidad, descuento menor
    } else if (conversion_probability >= 40) {
      discount = 20; // Probabilidad media
    } else {
      discount = 30; // Baja probabilidad, descuento mayor
    }

    // Ajustes basados en engagement y uso
    if (engagement_score > 70) discount = Math.max(10, discount - 5);
    if (usage_percentage > 80) discount = Math.max(10, discount - 5);

    return Math.min(50, discount); // Máximo 50% de descuento
  }

  private generateOfferCode(tenantId: string): string {
    const prefix = 'TRIAL';
    const suffix = tenantId.substring(0, 8).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}-${suffix}-${random}`;
  }

  private async createPaidSubscriptionFromTrial(
    trialSubscription: any,
    paymentMethodId: string,
    billingCycle: 'monthly' | 'yearly',
    discountPercentage: number
  ): Promise<Subscription> {
    // Crear nueva suscripción de pago con descuento
    return await billingService.createSubscription({
      tenant_id: trialSubscription.tenant_id,
      plan_id: trialSubscription.plan_id,
      billing_cycle: billingCycle,
      payment_method_id: paymentMethodId,
      created_by: trialSubscription.tenants.owner_id,
      addons: [], // TODO: Copiar addons del trial si existen
      coupon: `TRIAL_CONVERSION_${discountPercentage}`
    });
  }

  private async getActiveOffer(subscriptionId: string): Promise<any> {
    const { data: offer } = await supabase
      .from('trial_conversion_offers')
      .select('*')
      .eq('subscription_id', subscriptionId)
      .eq('conversion_successful', false)
      .gte('valid_until', new Date().toISOString())
      .single();

    return offer;
  }

  private async sendTrialExpirationNotification(trial: any): Promise<void> {
    const daysLeft = Math.ceil(
      (new Date(trial.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    await notificationService.notifyTenantAdmins(trial.tenant_id, {
      type: 'trial_expiring',
      title: 'Tu trial está expirando',
      message: `Tu trial de ${trial.subscription_plans.display_name} expira ${daysLeft === 0 ? 'hoy' : `en ${daysLeft} días`}`,
      priority: 'high',
      action_url: '/billing/convert-trial',
      action_label: 'Convertir ahora',
      data: {
        subscription_id: trial.id,
        days_left: daysLeft,
        plan_name: trial.subscription_plans.display_name
      }
    });
  }

  private async scheduleTrialCancellation(subscriptionId: string): Promise<void> {
    // En una implementación real, esto usaría un job queue como Bull/Agenda
    // Por ahora, simplemente marcamos para procesamiento batch
    await supabase
      .from('scheduled_tasks')
      .insert({
        task_type: 'cancel_expired_trial',
        resource_id: subscriptionId,
        scheduled_for: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Mañana
        data: { subscription_id: subscriptionId }
      });
  }

  private async sendConversionEmail(subscription: any, offer: any): Promise<void> {
    const tenant = subscription.tenants;
    const plan = subscription.subscription_plans;

    await emailService.sendTrialConversionOffer({
      to: tenant.email,
      tenant_name: tenant.razon_social,
      plan_name: plan.display_name,
      discount_percentage: offer.discount_percentage,
      offer_code: offer.offer_code,
      valid_until: new Date(offer.valid_until),
      conversion_url: `${process.env.FRONTEND_URL}/billing/convert-trial?offer=${offer.offer_code}`
    });
  }

  private async sendConversionConfirmationEmail(
    originalSubscription: any,
    convertedSubscription: any,
    offer: any
  ): Promise<void> {
    const tenant = originalSubscription.tenants;
    const plan = originalSubscription.subscription_plans;

    await emailService.sendTrialConversionConfirmation({
      to: tenant.email,
      tenant_name: tenant.razon_social,
      plan_name: plan.display_name,
      discount_applied: offer.discount_percentage,
      amount_saved: (plan.price_monthly * offer.discount_percentage) / 100,
      next_billing_date: new Date(convertedSubscription.current_period_end)
    });
  }

  private async updateCampaignMetrics(campaignId: string, action: 'sent' | 'converted'): Promise<void> {
    const field = action === 'sent' ? 'emails_sent' : 'conversions';
    
    await supabase.rpc('increment_campaign_metric', {
      campaign_id: campaignId,
      metric_field: field,
      increment_value: 1
    });
  }
}

export const trialService = new TrialService();