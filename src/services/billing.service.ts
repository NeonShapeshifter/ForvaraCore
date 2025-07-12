import Stripe from 'stripe';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { config } from '../config';
import { logger } from '../config/logger';
import { stripeService } from './stripe.service';
import { subscriptionService } from './subscription.service';
import { tenantService } from './tenant.service';
import { emailService } from './email.service';
import { 
  NotFoundError, 
  ValidationError,
  PaymentError,
  Subscription,
  SubscriptionPlan,
  Invoice,
  PaymentMethod,
  BillingInfo
} from '../types';
import { ACTIVITY_ACTIONS } from '../constants';

const stripe = new Stripe(config.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16'
});

// const supabase = getSupabase(); // Moved to lazy loading
// const redis = getRedis(); // Moved to lazy loading

interface CreateSubscriptionParams {
  tenant_id: string;
  plan_id: string;
  billing_cycle: 'monthly' | 'yearly';
  addons?: string[];
  coupon?: string;
  payment_method_id?: string;
  created_by: string;
}

interface UpdateSubscriptionParams {
  plan_id?: string;
  billing_cycle?: 'monthly' | 'yearly';
  immediate?: boolean;
}

interface CancelSubscriptionParams {
  immediate?: boolean;
  reason?: string;
  feedback?: string;
  canceled_by: string;
}

interface PlanChangePreview {
  current_plan: SubscriptionPlan;
  new_plan: SubscriptionPlan;
  proration_amount: number;
  amount_due: number;
  effective_date: Date;
  next_billing_date: Date;
  savings?: number;
  additional_cost?: number;
}

interface BillingHistory {
  id: string;
  date: Date;
  amount: number;
  currency: string;
  status: string;
  description: string;
  invoice_url?: string;
  pdf_url?: string;
}

interface NextBillingInfo {
  date: Date;
  amount: number;
  currency: string;
  description: string;
  items: {
    name: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
}

class BillingService {
  /**
   * Crear nueva suscripción
   */
  async createSubscription(params: CreateSubscriptionParams): Promise<Subscription> {
    try {
      const { 
        tenant_id, 
        plan_id, 
        billing_cycle, 
        addons = [], 
        coupon, 
        payment_method_id,
        created_by 
      } = params;

      // Obtener tenant y plan
      const [tenant, plan] = await Promise.all([
        tenantService.getTenantById(tenant_id),
        this.getPlanById(plan_id)
      ]);

      // Verificar que no hay suscripción activa para esta app
      const existingSubscription = await this.getActiveSubscription(tenant_id, plan.app_id);
      if (existingSubscription) {
        throw new ValidationError('Ya existe una suscripción activa para esta aplicación');
      }

      // Crear o actualizar customer en Stripe
      const customer = await stripeService.createOrUpdateCustomer({
        tenantId: tenant_id,
        email: tenant.email,
        name: tenant.razon_social,
        metadata: {
          ruc: tenant.ruc,
          created_by
        }
      });

      let subscription: Subscription;

      // Si es un plan gratuito o trial, crear directamente
      if (plan.price_monthly === 0 || plan.has_trial) {
        subscription = await this.createTrialOrFreeSubscription({
          tenant_id,
          plan_id,
          billing_cycle,
          addons,
          created_by
        });
      } else {
        // Crear suscripción de pago
        if (!payment_method_id) {
          throw new ValidationError('Se requiere un método de pago para este plan');
        }

        subscription = await this.createPaidSubscription({
          tenant_id,
          plan_id,
          billing_cycle,
          addons,
          coupon,
          payment_method_id,
          customer_id: customer.id,
          created_by
        });
      }

      // Aplicar addons si existen
      if (addons.length > 0) {
        await this.addSubscriptionAddons(subscription.id, addons);
      }

      // Actualizar límites del tenant
      await this.updateTenantLimits(tenant_id);

      logger.info({ 
        subscriptionId: subscription.id, 
        tenantId: tenant_id, 
        planId: plan_id 
      }, 'Subscription created successfully');

      return subscription;
    } catch (error) {
      logger.error({ error, params }, 'Create subscription failed');
      throw error;
    }
  }

  /**
   * Actualizar suscripción existente
   */
  async updateSubscription(
    subscriptionId: string, 
    params: UpdateSubscriptionParams
  ): Promise<Subscription> {
    try {
      const { plan_id, billing_cycle, immediate = false } = params;

      // Obtener suscripción actual
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      // Si no hay cambios, retornar la suscripción actual
      if (!plan_id && !billing_cycle) {
        return subscription;
      }

      // Obtener tenant para validación
      const tenant = await tenantService.getTenantById(subscription.tenant_id);

      let updatedSubscription = subscription;

      // Cambio de plan
      if (plan_id && plan_id !== subscription.plan_id) {
        const newPlan = await this.getPlanById(plan_id);
        
        // Verificar que es para la misma app
        if (newPlan.app_id !== subscription.app_id) {
          throw new ValidationError('No puedes cambiar a un plan de otra aplicación');
        }

        // Actualizar en Stripe si existe stripe_subscription_id
        if (subscription.stripe_subscription_id) {
          await this.updateStripeSubscription(subscription, newPlan, immediate);
        }

        // Actualizar en base de datos
        const { data: updated, error } = await supabase
          .from('subscriptions')
          .update({
            plan_id: plan_id,
            plan: newPlan.name,
            price_monthly: billing_cycle === 'yearly' ? newPlan.price_yearly : newPlan.price_monthly,
            billing_cycle: billing_cycle || subscription.billing_cycle,
            updated_at: new Date().toISOString()
          })
          .eq('id', subscriptionId)
          .select()
          .single();

        if (error) throw error;
        updatedSubscription = updated;

        // Aplicar nuevas features del plan
        await this.applyPlanFeatures(subscription.tenant_id, plan_id);
      }

      // Solo cambio de ciclo de facturación
      if (billing_cycle && billing_cycle !== subscription.billing_cycle) {
        const currentPlan = await this.getPlanById(subscription.plan_id!);
        const newPrice = billing_cycle === 'yearly' ? currentPlan.price_yearly : currentPlan.price_monthly;

        const { data: updated, error } = await supabase
          .from('subscriptions')
          .update({
            billing_cycle,
            price_monthly: newPrice,
            updated_at: new Date().toISOString()
          })
          .eq('id', subscriptionId)
          .select()
          .single();

        if (error) throw error;
        updatedSubscription = updated;
      }

      // Actualizar límites del tenant
      await this.updateTenantLimits(subscription.tenant_id);

      logger.info({ 
        subscriptionId, 
        changes: { plan_id, billing_cycle, immediate } 
      }, 'Subscription updated successfully');

      return updatedSubscription;
    } catch (error) {
      logger.error({ error, subscriptionId, params }, 'Update subscription failed');
      throw error;
    }
  }

  /**
   * Cancelar suscripción
   */
  async cancelSubscription(
    subscriptionId: string, 
    params: CancelSubscriptionParams
  ): Promise<Subscription> {
    try {
      const { immediate = false, reason, feedback, canceled_by } = params;

      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      // Cancelar en Stripe si existe
      if (subscription.stripe_subscription_id) {
        await stripeService.cancelSubscription(subscription.stripe_subscription_id, immediate);
      }

      // Calcular fecha de finalización
      const endsAt = immediate 
        ? new Date() 
        : new Date(subscription.current_period_end);

      // Actualizar en base de datos
      const { data: canceledSubscription, error } = await supabase
        .from('subscriptions')
        .update({
          status: immediate ? 'canceled' : 'active',
          canceled_at: new Date().toISOString(),
          cancel_reason: reason,
          ends_at: endsAt.toISOString(),
          metadata: {
            ...subscription.metadata,
            cancellation_feedback: feedback,
            canceled_by
          },
          updated_at: new Date().toISOString()
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (error) throw error;

      // Si es cancelación inmediata, remover features
      if (immediate) {
        await this.removePlanFeatures(subscription.tenant_id, subscription.plan_id!);
        await this.updateTenantLimits(subscription.tenant_id);
      }

      logger.info({ 
        subscriptionId, 
        immediate, 
        reason, 
        endsAt 
      }, 'Subscription canceled successfully');

      return canceledSubscription;
    } catch (error) {
      logger.error({ error, subscriptionId, params }, 'Cancel subscription failed');
      throw error;
    }
  }

  /**
   * Reactivar suscripción cancelada
   */
  async reactivateSubscription(subscriptionId: string): Promise<Subscription> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      if (subscription.status !== 'canceled') {
        throw new ValidationError('Solo puedes reactivar suscripciones canceladas');
      }

      // Verificar que no haya expirado
      if (subscription.ends_at && new Date(subscription.ends_at) < new Date()) {
        throw new ValidationError('La suscripción ya expiró');
      }

      // Reactivar en Stripe si existe
      if (subscription.stripe_subscription_id) {
        await stripe.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: false
        });
      }

      // Actualizar en base de datos
      const { data: reactivatedSubscription, error } = await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          canceled_at: null,
          cancel_reason: null,
          ends_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (error) throw error;

      // Reaplicar features del plan
      await this.applyPlanFeatures(subscription.tenant_id, subscription.plan_id!);
      await this.updateTenantLimits(subscription.tenant_id);

      logger.info({ subscriptionId }, 'Subscription reactivated successfully');

      return reactivatedSubscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Reactivate subscription failed');
      throw error;
    }
  }

  /**
   * Obtener preview de cambio de plan
   */
  async previewPlanChange(
    subscriptionId: string,
    newPlanId: string,
    billingCycle: 'monthly' | 'yearly',
    immediate: boolean = false
  ): Promise<PlanChangePreview> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      const [currentPlan, newPlan] = await Promise.all([
        this.getPlanById(subscription.plan_id!),
        this.getPlanById(newPlanId)
      ]);

      const currentPrice = subscription.billing_cycle === 'yearly' 
        ? currentPlan.price_yearly 
        : currentPlan.price_monthly;

      const newPrice = billingCycle === 'yearly' 
        ? newPlan.price_yearly 
        : newPlan.price_monthly;

      let prorationAmount = 0;
      let amountDue = 0;
      let effectiveDate = new Date();
      let nextBillingDate = new Date(subscription.current_period_end);

      if (subscription.stripe_subscription_id) {
        // Obtener preview de Stripe
        const preview = await stripe.invoices.retrieveUpcoming({
          customer: subscription.stripe_customer_id,
          subscription: subscription.stripe_subscription_id,
          subscription_items: [{
            id: subscription.stripe_subscription_item_id,
            price: newPlan.stripe_price_id,
            quantity: 1
          }],
          subscription_proration_behavior: immediate ? 'always_invoice' : 'none'
        });

        prorationAmount = preview.amount_due / 100;
        amountDue = Math.max(0, prorationAmount);
      } else {
        // Calcular manualmente para suscripciones sin Stripe
        if (immediate) {
          const remainingDays = Math.ceil(
            (nextBillingDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
          );
          const daysInCycle = subscription.billing_cycle === 'yearly' ? 365 : 30;
          
          const refund = (currentPrice * remainingDays) / daysInCycle;
          const newCharge = (newPrice * remainingDays) / daysInCycle;
          
          prorationAmount = newCharge - refund;
          amountDue = Math.max(0, prorationAmount);
        } else {
          effectiveDate = nextBillingDate;
          amountDue = 0;
        }
      }

      const preview: PlanChangePreview = {
        current_plan: currentPlan,
        new_plan: newPlan,
        proration_amount: prorationAmount,
        amount_due: amountDue,
        effective_date: effectiveDate,
        next_billing_date: nextBillingDate
      };

      // Calcular ahorros o costo adicional
      const priceDifference = newPrice - currentPrice;
      if (priceDifference > 0) {
        preview.additional_cost = priceDifference;
      } else if (priceDifference < 0) {
        preview.savings = Math.abs(priceDifference);
      }

      return preview;
    } catch (error) {
      logger.error({ error, subscriptionId, newPlanId }, 'Preview plan change failed');
      throw error;
    }
  }

  /**
   * Obtener historial de facturación
   */
  async getBillingHistory(
    subscriptionId: string, 
    limit: number = 10
  ): Promise<BillingHistory[]> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      // Obtener de la tabla de facturas locales
      const { data: localInvoices } = await supabase
        .from('invoices')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      let history: BillingHistory[] = [];

      // Mapear facturas locales
      if (localInvoices) {
        history = localInvoices.map(invoice => ({
          id: invoice.id,
          date: new Date(invoice.created_at),
          amount: invoice.amount_due,
          currency: invoice.currency,
          status: invoice.status,
          description: invoice.description || `Factura ${invoice.invoice_number}`,
          invoice_url: invoice.hosted_invoice_url,
          pdf_url: invoice.pdf_url
        }));
      }

      // Si hay customer de Stripe, obtener también de ahí
      if (subscription.stripe_customer_id) {
        try {
          const stripeInvoices = await stripeService.listInvoices(
            subscription.stripe_customer_id, 
            limit
          );

          // Combinar con facturas locales (evitar duplicados)
          const stripeHistory = stripeInvoices
            .filter(si => !history.find(h => h.id === si.id))
            .map(si => ({
              id: si.id,
              date: new Date(si.created * 1000),
              amount: si.amount_paid / 100,
              currency: si.currency,
              status: si.status || 'unknown',
              description: si.description || `Stripe Invoice ${si.number}`,
              invoice_url: si.hosted_invoice_url,
              pdf_url: si.invoice_pdf
            }));

          history = [...history, ...stripeHistory];
        } catch (stripeError) {
          logger.warn({ error: stripeError, subscriptionId }, 'Failed to fetch Stripe invoices');
        }
      }

      // Ordenar por fecha descendente
      history.sort((a, b) => b.date.getTime() - a.date.getTime());

      return history.slice(0, limit);
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Get billing history failed');
      throw error;
    }
  }

  /**
   * Obtener información de próxima facturación
   */
  async getNextBillingInfo(subscriptionId: string): Promise<NextBillingInfo | null> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription || !['active', 'trialing'].includes(subscription.status)) {
        return null;
      }

      const plan = await this.getPlanById(subscription.plan_id!);
      const baseAmount = subscription.billing_cycle === 'yearly' 
        ? plan.price_yearly 
        : plan.price_monthly;

      // Obtener addons activos
      const { data: activeAddons } = await supabase
        .from('subscription_addons')
        .select(`
          *,
          addons (
            id,
            name,
            display_name,
            price_monthly,
            unit_label
          )
        `)
        .eq('subscription_id', subscriptionId);

      const items = [{
        name: plan.display_name,
        quantity: 1,
        unit_price: baseAmount,
        total: baseAmount
      }];

      let totalAmount = baseAmount;

      // Agregar addons
      if (activeAddons) {
        for (const addon of activeAddons) {
          const addonPrice = addon.addons.price_monthly * addon.quantity;
          totalAmount += addonPrice;
          
          items.push({
            name: `${addon.addons.display_name} (${addon.addons.unit_label})`,
            quantity: addon.quantity,
            unit_price: addon.addons.price_monthly,
            total: addonPrice
          });
        }
      }

      return {
        date: new Date(subscription.current_period_end),
        amount: totalAmount,
        currency: subscription.currency || 'USD',
        description: `Renovación de ${plan.display_name}`,
        items
      };
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Get next billing info failed');
      throw error;
    }
  }

  /**
   * Verificar si tenant tiene método de pago válido
   */
  async hasValidPaymentMethod(tenantId: string): Promise<boolean> {
    try {
      const { data: paymentMethods } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('active', true);

      return paymentMethods && paymentMethods.length > 0;
    } catch (error) {
      logger.error({ error, tenantId }, 'Check payment method failed');
      return false;
    }
  }

  /**
   * Agregar addon a suscripción
   */
  async addSubscriptionAddon(
    subscriptionId: string,
    addonId: string,
    quantity: number = 1
  ): Promise<Subscription> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      const addon = await this.getAddonById(addonId);
      if (!addon) {
        throw new NotFoundError('Addon');
      }

      // Verificar que el addon es compatible con la app
      if (addon.app_id !== subscription.app_id) {
        throw new ValidationError('El addon no es compatible con esta aplicación');
      }

      // Verificar si ya existe
      const { data: existingAddon } = await supabase
        .from('subscription_addons')
        .select('*')
        .eq('subscription_id', subscriptionId)
        .eq('addon_id', addonId)
        .single();

      if (existingAddon) {
        // Actualizar cantidad
        await supabase
          .from('subscription_addons')
          .update({
            quantity: existingAddon.quantity + quantity,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAddon.id);
      } else {
        // Crear nuevo
        await supabase
          .from('subscription_addons')
          .insert({
            subscription_id: subscriptionId,
            addon_id: addonId,
            quantity
          });
      }

      // Actualizar precio total de la suscripción
      await this.recalculateSubscriptionPrice(subscriptionId);

      // Obtener suscripción actualizada
      const updatedSubscription = await this.getSubscriptionById(subscriptionId);

      logger.info({ 
        subscriptionId, 
        addonId, 
        quantity 
      }, 'Addon added to subscription');

      return updatedSubscription!;
    } catch (error) {
      logger.error({ error, subscriptionId, addonId }, 'Add subscription addon failed');
      throw error;
    }
  }

  /**
   * Remover addon de suscripción
   */
  async removeSubscriptionAddon(
    subscriptionId: string,
    addonId: string
  ): Promise<Subscription> {
    try {
      const subscription = await this.getSubscriptionById(subscriptionId);
      if (!subscription) {
        throw new NotFoundError('Suscripción');
      }

      // Remover addon
      await supabase
        .from('subscription_addons')
        .delete()
        .eq('subscription_id', subscriptionId)
        .eq('addon_id', addonId);

      // Recalcular precio
      await this.recalculateSubscriptionPrice(subscriptionId);

      // Obtener suscripción actualizada
      const updatedSubscription = await this.getSubscriptionById(subscriptionId);

      logger.info({ 
        subscriptionId, 
        addonId 
      }, 'Addon removed from subscription');

      return updatedSubscription!;
    } catch (error) {
      logger.error({ error, subscriptionId, addonId }, 'Remove subscription addon failed');
      throw error;
    }
  }

  // Métodos auxiliares privados

  private async getSubscriptionById(subscriptionId: string): Promise<Subscription | null> {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subscriptionId)
      .single();

    return subscription;
  }

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

  private async getAddonById(addonId: string): Promise<any> {
    const { data: addon } = await supabase
      .from('addons')
      .select('*')
      .eq('id', addonId)
      .single();

    return addon;
  }

  private async getActiveSubscription(tenantId: string, appId: string): Promise<Subscription | null> {
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('app_id', appId)
      .in('status', ['active', 'trialing'])
      .single();

    return subscription;
  }

  private async createTrialOrFreeSubscription(params: {
    tenant_id: string;
    plan_id: string;
    billing_cycle: 'monthly' | 'yearly';
    addons: string[];
    created_by: string;
  }): Promise<Subscription> {
    const { tenant_id, plan_id, billing_cycle, created_by } = params;
    
    const plan = await this.getPlanById(plan_id);
    const now = new Date();
    const periodEnd = new Date(now);
    
    if (plan.has_trial) {
      periodEnd.setDate(periodEnd.getDate() + (plan.trial_days || 14));
    } else {
      // Plan gratuito, período de 1 año
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    }

    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .insert({
        id: uuidv4(),
        tenant_id,
        app_id: plan.app_id,
        plan_id,
        plan: plan.name,
        status: plan.has_trial ? 'trialing' : 'active',
        billing_cycle,
        price_monthly: 0,
        currency: plan.currency,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        trial_ends_at: plan.has_trial ? periodEnd.toISOString() : null,
        metadata: {
          created_by,
          is_trial: plan.has_trial,
          is_free: plan.price_monthly === 0
        }
      })
      .select()
      .single();

    if (error) throw error;

    return subscription;
  }

  private async createPaidSubscription(params: {
    tenant_id: string;
    plan_id: string;
    billing_cycle: 'monthly' | 'yearly';
    addons: string[];
    coupon?: string;
    payment_method_id: string;
    customer_id: string;
    created_by: string;
  }): Promise<Subscription> {
    const { 
      tenant_id, 
      plan_id, 
      billing_cycle, 
      coupon, 
      payment_method_id, 
      customer_id 
    } = params;

    const plan = await this.getPlanById(plan_id);
    
    // Adjuntar método de pago
    await stripeService.attachPaymentMethod(customer_id, payment_method_id);

    // Crear suscripción en Stripe
    const stripeSubscription = await stripeService.createSubscription({
      customerId: customer_id,
      priceId: plan.stripe_price_id,
      quantity: 1,
      trialDays: plan.has_trial ? plan.trial_days : undefined,
      metadata: {
        tenant_id,
        plan_id,
        billing_cycle
      }
    });

    // Guardar en base de datos
    const { data: subscription, error } = await supabase
      .from('subscriptions')
      .insert({
        id: uuidv4(),
        tenant_id,
        app_id: plan.app_id,
        plan_id,
        plan: plan.name,
        stripe_subscription_id: stripeSubscription.id,
        stripe_customer_id: customer_id,
        status: stripeSubscription.status,
        billing_cycle,
        price_monthly: billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly,
        currency: plan.currency,
        current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
        trial_ends_at: stripeSubscription.trial_end 
          ? new Date(stripeSubscription.trial_end * 1000).toISOString() 
          : null,
        metadata: {
          coupon,
          stripe_subscription_id: stripeSubscription.id
        }
      })
      .select()
      .single();

    if (error) throw error;

    return subscription;
  }

  private async addSubscriptionAddons(subscriptionId: string, addonIds: string[]): Promise<void> {
    for (const addonId of addonIds) {
      await this.addSubscriptionAddon(subscriptionId, addonId, 1);
    }
  }

  private async updateStripeSubscription(
    subscription: Subscription,
    newPlan: SubscriptionPlan,
    immediate: boolean
  ): Promise<void> {
    if (!subscription.stripe_subscription_id) return;

    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      items: [{
        id: subscription.stripe_subscription_item_id,
        price: newPlan.stripe_price_id
      }],
      proration_behavior: immediate ? 'always_invoice' : 'none'
    });
  }

  private async recalculateSubscriptionPrice(subscriptionId: string): Promise<void> {
    const subscription = await this.getSubscriptionById(subscriptionId);
    if (!subscription) return;

    const plan = await this.getPlanById(subscription.plan_id!);
    let totalPrice = subscription.billing_cycle === 'yearly' 
      ? plan.price_yearly 
      : plan.price_monthly;

    // Sumar addons
    const { data: addons } = await supabase
      .from('subscription_addons')
      .select(`
        quantity,
        addons (price_monthly)
      `)
      .eq('subscription_id', subscriptionId);

    if (addons) {
      for (const addon of addons) {
        totalPrice += addon.addons.price_monthly * addon.quantity;
      }
    }

    // Actualizar precio
    await supabase
      .from('subscriptions')
      .update({
        price_monthly: totalPrice,
        updated_at: new Date().toISOString()
      })
      .eq('id', subscriptionId);
  }

  private async applyPlanFeatures(tenantId: string, planId: string): Promise<void> {
    // Reutilizar lógica del subscriptionService
    await subscriptionService.applyPlanFeatures(tenantId, planId);
  }

  private async removePlanFeatures(tenantId: string, planId: string): Promise<void> {
    // Reutilizar lógica del subscriptionService
    await subscriptionService.removePlanFeatures(tenantId, planId);
  }

  private async updateTenantLimits(tenantId: string): Promise<void> {
    // Actualizar límites calculados del tenant
    await supabase.rpc('refresh_tenant_limits', { tenant_id: tenantId });
  }
}

export const billingService = new BillingService();