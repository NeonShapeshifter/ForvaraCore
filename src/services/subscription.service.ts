import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';
import { 
  NotFoundError, 
  ValidationError,
  PaymentError,
  Subscription,
  SubscriptionPlan,
  SubscriptionFeature,
  PaginatedResponse,
  BillingInfo,
  Invoice
} from '../types';
import { activityService } from './activity.service';
import { notificationService } from './notification.service';
import { tenantService } from './tenant.service';
import { addEmailJob } from '../queues';
import { ACTIVITY_ACTIONS } from '../constants';

const stripe = new Stripe(config.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

const supabase = getSupabase();
const redis = getRedis();

class SubscriptionService {
  /**
   * Obtener planes disponibles
   */
  async getAvailablePlans(appId?: string): Promise<SubscriptionPlan[]> {
    const cacheKey = appId ? `plans:${appId}` : 'plans:all';
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    let query = supabase
      .from('subscription_plans')
      .select(`
        *,
        plan_features (
          feature_id,
          value,
          features (*)
        )
      `)
      .eq('is_active', true)
      .order('price_monthly', { ascending: true });

    if (appId) {
      query = query.eq('app_id', appId);
    }

    const { data: plans, error } = await query;

    if (error) throw error;

    // Cachear por 1 hora
    await redis.setex(cacheKey, 3600, JSON.stringify(plans || []));

    return plans || [];
  }

  /**
   * Crear suscripción trial
   */
  async createTrialSubscription(tenantId: string): Promise<Subscription> {
    try {
      // Obtener plan trial
      const { data: trialPlan } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_trial', true)
        .single();

      if (!trialPlan) {
        throw new NotFoundError('Plan trial no encontrado');
      }

      // Crear suscripción
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + (trialPlan.trial_days || 14));

      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .insert({
          id: uuidv4(),
          tenant_id: tenantId,
          plan_id: trialPlan.id,
          status: 'trialing',
          current_period_start: new Date().toISOString(),
          current_period_end: trialEnd.toISOString(),
          trial_end: trialEnd.toISOString(),
          quantity: 1,
          metadata: {
            source: 'automatic',
            trial_type: 'new_tenant'
          }
        })
        .select()
        .single();

      if (error) throw error;

      // Aplicar features del plan
      await this.applyPlanFeatures(tenantId, trialPlan.id);

      logger.info({ 
        tenantId, 
        planId: trialPlan.id, 
        trialDays: trialPlan.trial_days 
      }, 'Trial subscription created');

      return subscription;
    } catch (error) {
      logger.error({ error, tenantId }, 'Create trial subscription failed');
      throw error;
    }
  }

  /**
   * Crear suscripción de pago
   */
  async createSubscription(params: {
    tenantId: string;
    planId: string;
    paymentMethodId: string;
    quantity?: number;
    couponCode?: string;
    metadata?: Record<string, any>;
  }): Promise<Subscription> {
    try {
      const { tenantId, planId, paymentMethodId, quantity = 1, couponCode, metadata } = params;

      // Obtener tenant y plan
      const [tenant, plan] = await Promise.all([
        tenantService.getTenantById(tenantId),
        this.getPlanById(planId)
      ]);

      // Crear o obtener customer en Stripe
      let stripeCustomerId = tenant.stripe_customer_id;
      
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: tenant.razon_social,
          email: tenant.email,
          metadata: {
            tenant_id: tenantId,
            ruc: tenant.ruc
          }
        });
        
        stripeCustomerId = customer.id;
        
        // Guardar customer ID
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', tenantId);
      }

      // Adjuntar método de pago
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId
      });

      // Establecer como método de pago por defecto
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });

      // Crear suscripción en Stripe
      const subscriptionParams: Stripe.SubscriptionCreateParams = {
        customer: stripeCustomerId,
        items: [{
          price: plan.stripe_price_id,
          quantity
        }],
        payment_behavior: 'default_incomplete',
        payment_settings: { 
          save_default_payment_method: 'on_subscription' 
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          tenant_id: tenantId,
          plan_id: planId,
          ...metadata
        }
      };

      // Aplicar cupón si existe
      if (couponCode) {
        const coupon = await this.validateCoupon(couponCode);
        subscriptionParams.coupon = coupon.stripe_coupon_id;
      }

      const stripeSubscription = await stripe.subscriptions.create(subscriptionParams);

      // Guardar en base de datos
      const { data: subscription, error } = await supabase
        .from('subscriptions')
        .insert({
          id: uuidv4(),
          tenant_id: tenantId,
          plan_id: planId,
          stripe_subscription_id: stripeSubscription.id,
          status: stripeSubscription.status,
          quantity,
          current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: false,
          metadata: {
            ...metadata,
            coupon_code: couponCode
          }
        })
        .select()
        .single();

      if (error) throw error;

      // Si la suscripción está activa, aplicar features
      if (stripeSubscription.status === 'active') {
        await this.applyPlanFeatures(tenantId, planId);
      }

      // Registrar actividad
      await activityService.log({
        tenant_id: tenantId,
        user_id: tenant.owner_id,
        action: ACTIVITY_ACTIONS.SUBSCRIPTION_CREATED,
        resource_type: 'subscription',
        resource_id: subscription.id,
        details: {
          plan_name: plan.name,
          price: plan.price_monthly * quantity,
          quantity
        }
      });

      // Notificar
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'subscription_created',
        title: 'Nueva suscripción',
        message: `Se ha activado el plan ${plan.name}`,
        data: { subscriptionId: subscription.id, planName: plan.name }
      });

      logger.info({ 
        subscriptionId: subscription.id,
        tenantId, 
        planId,
        stripeSubscriptionId: stripeSubscription.id 
      }, 'Subscription created');

      return subscription;
    } catch (error: any) {
      logger.error({ error, params }, 'Create subscription failed');
      
      if (error.type === 'StripeCardError') {
        throw new PaymentError('Tarjeta rechazada: ' + error.message);
      }
      
      throw error;
    }
  }

  /**
   * Actualizar suscripción
   */
  async updateSubscription(
    subscriptionId: string,
    updates: {
      planId?: string;
      quantity?: number;
      paymentMethodId?: string;
    }
  ): Promise<Subscription> {
    try {
      // Obtener suscripción actual
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*, tenants(*)')
        .eq('id', subscriptionId)
        .single();

      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      const updateParams: Stripe.SubscriptionUpdateParams = {};

      // Cambio de plan
      if (updates.planId && updates.planId !== subscription.plan_id) {
        const newPlan = await this.getPlanById(updates.planId);
        
        updateParams.items = [{
          id: subscription.stripe_subscription_item_id,
          price: newPlan.stripe_price_id
        }];

        // Si es downgrade, aplicar al final del período
        if (newPlan.price_monthly < subscription.plan.price_monthly) {
          updateParams.proration_behavior = 'none';
          updateParams.billing_cycle_anchor = 'unchanged';
        } else {
          updateParams.proration_behavior = 'always_invoice';
        }
      }

      // Cambio de cantidad
      if (updates.quantity) {
        updateParams.items = updateParams.items || [];
        updateParams.items.push({
          id: subscription.stripe_subscription_item_id,
          quantity: updates.quantity
        });
      }

      // Cambio de método de pago
      if (updates.paymentMethodId) {
        await stripe.paymentMethods.attach(updates.paymentMethodId, {
          customer: subscription.tenants.stripe_customer_id
        });

        updateParams.default_payment_method = updates.paymentMethodId;
      }

      // Actualizar en Stripe
      const stripeSubscription = await stripe.subscriptions.update(
        subscription.stripe_subscription_id,
        updateParams
      );

      // Actualizar en base de datos
      const { data: updatedSubscription, error } = await supabase
        .from('subscriptions')
        .update({
          plan_id: updates.planId || subscription.plan_id,
          quantity: updates.quantity || subscription.quantity,
          updated_at: new Date().toISOString()
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (error) throw error;

      // Si cambió el plan, actualizar features
      if (updates.planId && updates.planId !== subscription.plan_id) {
        await this.applyPlanFeatures(subscription.tenant_id, updates.planId);
      }

      // Registrar actividad
      await activityService.log({
        tenant_id: subscription.tenant_id,
        user_id: subscription.tenants.owner_id,
        action: ACTIVITY_ACTIONS.SUBSCRIPTION_UPDATED,
        resource_type: 'subscription',
        resource_id: subscriptionId,
        details: { updates }
      });

      logger.info({ 
        subscriptionId, 
        updates 
      }, 'Subscription updated');

      return updatedSubscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Update subscription failed');
      throw error;
    }
  }

  /**
   * Cancelar suscripción
   */
  async cancelSubscription(
    subscriptionId: string,
    immediately: boolean = false,
    reason?: string
  ): Promise<Subscription> {
    try {
      // Obtener suscripción
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('id', subscriptionId)
        .single();

      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      // Cancelar en Stripe
      const cancelParams: Stripe.SubscriptionUpdateParams = {
        cancel_at_period_end: !immediately
      };

      if (immediately) {
        await stripe.subscriptions.del(subscription.stripe_subscription_id);
      } else {
        await stripe.subscriptions.update(
          subscription.stripe_subscription_id,
          cancelParams
        );
      }

      // Actualizar en base de datos
      const { data: cancelledSubscription, error } = await supabase
        .from('subscriptions')
        .update({
          status: immediately ? 'canceled' : subscription.status,
          cancel_at_period_end: !immediately,
          canceled_at: new Date().toISOString(),
          cancellation_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (error) throw error;

      // Si es cancelación inmediata, remover features
      if (immediately) {
        await this.removePlanFeatures(subscription.tenant_id, subscription.plan_id);
      }

      // Registrar actividad
      await activityService.log({
        tenant_id: subscription.tenant_id,
        action: ACTIVITY_ACTIONS.SUBSCRIPTION_CANCELLED,
        resource_type: 'subscription',
        resource_id: subscriptionId,
        details: { 
          immediately, 
          reason,
          cancel_date: immediately ? 'immediate' : subscription.current_period_end
        }
      });

      logger.info({ 
        subscriptionId, 
        immediately, 
        reason 
      }, 'Subscription cancelled');

      return cancelledSubscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Cancel subscription failed');
      throw error;
    }
  }

  /**
   * Obtener suscripciones de un tenant
   */
  async getTenantSubscriptions(
    tenantId: string,
    includeInactive: boolean = false
  ): Promise<Subscription[]> {
    let query = supabase
      .from('subscriptions')
      .select(`
        *,
        subscription_plans (
          id,
          name,
          description,
          price_monthly,
          price_yearly,
          features
        )
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!includeInactive) {
      query = query.in('status', ['active', 'trialing']);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  }

  /**
   * Verificar si tenant tiene acceso a feature
   */
  async checkFeatureAccess(
    tenantId: string,
    featureKey: string
  ): Promise<{ hasAccess: boolean; limit?: number; used?: number }> {
    try {
      // Obtener features activas del tenant
      const { data: features } = await supabase
        .from('tenant_features')
        .select(`
          *,
          features (*)
        `)
        .eq('tenant_id', tenantId)
        .eq('feature_key', featureKey)
        .eq('is_active', true)
        .single();

      if (!features) {
        return { hasAccess: false };
      }

      // Si es feature booleana
      if (features.features.type === 'boolean') {
        return { hasAccess: features.value === 'true' };
      }

      // Si es feature con límite
      if (features.features.type === 'limit') {
        const limit = parseInt(features.value);
        const used = features.current_usage || 0;
        
        return {
          hasAccess: used < limit,
          limit,
          used
        };
      }

      return { hasAccess: true };
    } catch (error) {
      logger.error({ error, tenantId, featureKey }, 'Check feature access failed');
      return { hasAccess: false };
    }
  }

  /**
   * Incrementar uso de feature
   */
  async incrementFeatureUsage(
    tenantId: string,
    featureKey: string,
    amount: number = 1
  ): Promise<void> {
    try {
      const { data: feature } = await supabase
        .from('tenant_features')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('feature_key', featureKey)
        .single();

      if (!feature) {
        throw new NotFoundError('Feature no encontrada');
      }

      const newUsage = (feature.current_usage || 0) + amount;
      const limit = parseInt(feature.value);

      if (newUsage > limit) {
        throw new ValidationError(`Límite excedido para ${featureKey}`);
      }

      await supabase
        .from('tenant_features')
        .update({
          current_usage: newUsage,
          updated_at: new Date().toISOString()
        })
        .eq('id', feature.id);

      // Si está cerca del límite, notificar
      const usagePercentage = (newUsage / limit) * 100;
      if (usagePercentage >= 80) {
        await notificationService.notifyTenantAdmins(tenantId, {
          type: 'feature_limit_warning',
          title: 'Límite de feature cerca',
          message: `${featureKey} está al ${Math.round(usagePercentage)}% del límite`,
          priority: 'medium'
        });
      }
    } catch (error) {
      logger.error({ error, tenantId, featureKey }, 'Increment feature usage failed');
      throw error;
    }
  }

  /**
   * Obtener historial de facturas
   */
  async getInvoices(
    tenantId: string,
    limit: number = 10
  ): Promise<Invoice[]> {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      if (!tenant?.stripe_customer_id) {
        return [];
      }

      const invoices = await stripe.invoices.list({
        customer: tenant.stripe_customer_id,
        limit
      });

      return invoices.data.map(invoice => ({
        id: invoice.id,
        number: invoice.number,
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: invoice.status,
        date: new Date(invoice.created * 1000),
        pdf_url: invoice.invoice_pdf,
        hosted_url: invoice.hosted_invoice_url,
        description: invoice.description
      }));
    } catch (error) {
      logger.error({ error, tenantId }, 'Get invoices failed');
      throw error;
    }
  }

  /**
   * Actualizar información de facturación
   */
  async updateBillingInfo(
    tenantId: string,
    billingInfo: BillingInfo
  ): Promise<void> {
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      if (!tenant) {
        throw new NotFoundError('Tenant');
      }

      // Actualizar en Stripe
      if (tenant.stripe_customer_id) {
        await stripe.customers.update(tenant.stripe_customer_id, {
          name: billingInfo.legal_name,
          email: billingInfo.email,
          phone: billingInfo.phone,
          address: {
            line1: billingInfo.address_line1,
            line2: billingInfo.address_line2,
            city: billingInfo.city,
            state: billingInfo.state,
            postal_code: billingInfo.postal_code,
            country: billingInfo.country
          },
          tax_id_data: billingInfo.tax_id ? [{
            type: billingInfo.tax_id_type || 'ec_ruc',
            value: billingInfo.tax_id
          }] : undefined
        });
      }

      // Actualizar en base de datos
      await supabase
        .from('tenants')
        .update({
          billing_info: billingInfo,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);

      logger.info({ tenantId }, 'Billing info updated');
    } catch (error) {
      logger.error({ error, tenantId }, 'Update billing info failed');
      throw error;
    }
  }

  /**
   * Transferir suscripciones a nuevo owner
   */
  async transferSubscriptions(
    tenantId: string,
    newOwnerId: string
  ): Promise<void> {
    try {
      // Obtener usuario nuevo
      const { data: newOwner } = await supabase
        .from('users')
        .select('email, stripe_customer_id')
        .eq('id', newOwnerId)
        .single();

      if (!newOwner) {
        throw new NotFoundError('Usuario');
      }

      // Obtener tenant
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      if (tenant?.stripe_customer_id) {
        // Actualizar email del customer en Stripe
        await stripe.customers.update(tenant.stripe_customer_id, {
          email: newOwner.email,
          metadata: {
            owner_id: newOwnerId
          }
        });
      }

      logger.info({ tenantId, newOwnerId }, 'Subscriptions transferred');
    } catch (error) {
      logger.error({ error, tenantId }, 'Transfer subscriptions failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async getPlanById(planId: string): Promise<SubscriptionPlan> {
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (!plan) {
      throw new NotFoundError('Plan de suscripción');
    }

    return plan;
  }

  private async validateCoupon(code: string): Promise<any> {
    try {
      // Buscar cupón en base de datos
      const { data: coupon } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', code)
        .eq('is_active', true)
        .single();

      if (!coupon) {
        throw new ValidationError('Cupón inválido');
      }

      // Verificar límites
      if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
        throw new ValidationError('Cupón agotado');
      }

      // Verificar fecha de expiración
      if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
        throw new ValidationError('Cupón expirado');
      }

      return coupon;
    } catch (error) {
      logger.error({ error, code }, 'Validate coupon failed');
      throw error;
    }
  }

  private async applyPlanFeatures(tenantId: string, planId: string): Promise<void> {
    try {
      // Obtener features del plan
      const { data: planFeatures } = await supabase
        .from('plan_features')
        .select(`
          *,
          features (*)
        `)
        .eq('plan_id', planId);

      if (!planFeatures) return;

      // Desactivar features actuales
      await supabase
        .from('tenant_features')
        .update({ is_active: false })
        .eq('tenant_id', tenantId);

      // Activar nuevas features
      const tenantFeatures = planFeatures.map(pf => ({
        tenant_id: tenantId,
        feature_id: pf.feature_id,
        feature_key: pf.features.key,
        value: pf.value,
        is_active: true,
        current_usage: 0
      }));

      await supabase
        .from('tenant_features')
        .upsert(tenantFeatures, {
          onConflict: 'tenant_id,feature_key'
        });

      logger.info({ tenantId, planId, featuresCount: planFeatures.length }, 'Plan features applied');
    } catch (error) {
      logger.error({ error, tenantId, planId }, 'Apply plan features failed');
      throw error;
    }
  }

  private async removePlanFeatures(tenantId: string, planId: string): Promise<void> {
    try {
      await supabase
        .from('tenant_features')
        .update({ 
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenantId);

      logger.info({ tenantId, planId }, 'Plan features removed');
    } catch (error) {
      logger.error({ error, tenantId, planId }, 'Remove plan features failed');
      throw error;
    }
  }
}

export const subscriptionService = new SubscriptionService();
