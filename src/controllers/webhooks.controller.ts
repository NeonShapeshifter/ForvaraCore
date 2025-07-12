import { Request, Response } from 'express';
import Stripe from 'stripe';
import { stripeService } from '../services/stripe.service';
import { billingService } from '../services/billing.service';
import { subscriptionService } from '../services/subscription.service';
import { notificationService } from '../services/notification.service';
import { emailService } from '../services/email.service';
import { tenantService } from '../services/tenant.service';
import { activityService } from '../services/activity.service';
import { getSupabase } from '../config/database';
import { logger } from '../config/logger';
import { config } from '../config';
import { ACTIVITY_ACTIONS } from '../constants';

const supabase = getSupabase();

/**
 * Webhook de Stripe para sincronizar eventos de suscripciones
 */
export const handleStripeWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const body = req.body;

    if (!signature) {
      logger.error('Missing Stripe signature');
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    // Verificar webhook signature
    const event = stripeService.verifyWebhookSignature(body, signature);
    
    logger.info({ 
      eventId: event.id, 
      eventType: event.type 
    }, 'Stripe webhook received');

    // Procesar evento según tipo
    await processStripeEvent(event);

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Stripe webhook processing failed');
    res.status(400).json({ error: error.message });
  }
};

/**
 * Procesar eventos de Stripe
 */
async function processStripeEvent(event: Stripe.Event): Promise<void> {
  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.finalized':
        await handleInvoiceFinalized(event.data.object as Stripe.Invoice);
        break;

      case 'customer.created':
        await handleCustomerCreated(event.data.object as Stripe.Customer);
        break;

      case 'customer.updated':
        await handleCustomerUpdated(event.data.object as Stripe.Customer);
        break;

      case 'payment_method.attached':
        await handlePaymentMethodAttached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'payment_method.detached':
        await handlePaymentMethodDetached(event.data.object as Stripe.PaymentMethod);
        break;

      case 'setup_intent.succeeded':
        await handleSetupIntentSucceeded(event.data.object as Stripe.SetupIntent);
        break;

      default:
        logger.info({ eventType: event.type }, 'Unhandled Stripe event type');
    }

    // Registrar evento procesado
    await supabase
      .from('stripe_events')
      .insert({
        stripe_event_id: event.id,
        event_type: event.type,
        processed_at: new Date().toISOString(),
        data: event.data.object
      });

  } catch (error) {
    logger.error({ error, eventId: event.id, eventType: event.type }, 'Stripe event processing failed');
    throw error;
  }
}

/**
 * Manejar creación de suscripción
 */
async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  try {
    const tenantId = subscription.metadata.tenant_id;
    const planId = subscription.metadata.plan_id;

    if (!tenantId || !planId) {
      logger.warn({ subscriptionId: subscription.id }, 'Missing tenant_id or plan_id in subscription metadata');
      return;
    }

    // Actualizar suscripción en base de datos
    const { error } = await supabase
      .from('subscriptions')
      .update({
        stripe_subscription_id: subscription.id,
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        trial_ends_at: subscription.trial_end 
          ? new Date(subscription.trial_end * 1000).toISOString() 
          : null,
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('plan_id', planId);

    if (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to update subscription in database');
      return;
    }

    // Si la suscripción está activa, aplicar features
    if (subscription.status === 'active') {
      await subscriptionService.applyPlanFeatures(tenantId, planId);
    }

    // Obtener información del tenant y plan
    const [tenant, plan] = await Promise.all([
      tenantService.getTenantById(tenantId),
      subscriptionService.getPlanById(planId)
    ]);

    // Notificar creación de suscripción
    if (tenant && plan) {
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'subscription_created',
        title: 'Suscripción activada',
        message: `Tu suscripción a ${plan.display_name} está activa`,
        data: {
          subscription_id: subscription.id,
          plan_name: plan.display_name,
          status: subscription.status
        }
      });
    }

    logger.info({ 
      subscriptionId: subscription.id, 
      tenantId, 
      planId,
      status: subscription.status 
    }, 'Subscription created webhook processed');

  } catch (error) {
    logger.error({ error, subscriptionId: subscription.id }, 'Handle subscription created failed');
  }
}

/**
 * Manejar actualización de suscripción
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  try {
    const tenantId = subscription.metadata.tenant_id;

    if (!tenantId) {
      logger.warn({ subscriptionId: subscription.id }, 'Missing tenant_id in subscription metadata');
      return;
    }

    // Actualizar suscripción en base de datos
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        trial_ends_at: subscription.trial_end 
          ? new Date(subscription.trial_end * 1000).toISOString() 
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at 
          ? new Date(subscription.canceled_at * 1000).toISOString() 
          : null,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to update subscription in database');
      return;
    }

    // Obtener suscripción local
    const { data: localSubscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .eq('stripe_subscription_id', subscription.id)
      .single();

    if (!localSubscription) {
      logger.warn({ subscriptionId: subscription.id }, 'Local subscription not found');
      return;
    }

    // Manejar cambios de estado
    if (subscription.status === 'active') {
      await subscriptionService.applyPlanFeatures(tenantId, localSubscription.plan_id);
    } else if (subscription.status === 'canceled') {
      await subscriptionService.removePlanFeatures(tenantId, localSubscription.plan_id);
    }

    // Notificar cambios importantes
    const statusMessages = {
      'active': 'Tu suscripción está activa',
      'canceled': 'Tu suscripción ha sido cancelada',
      'unpaid': 'Tu suscripción tiene pagos pendientes',
      'past_due': 'Tu suscripción está vencida'
    };

    const message = statusMessages[subscription.status as keyof typeof statusMessages];
    if (message) {
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'subscription_updated',
        title: 'Estado de suscripción actualizado',
        message,
        data: {
          subscription_id: subscription.id,
          plan_name: localSubscription.subscription_plans.display_name,
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end
        }
      });
    }

    logger.info({ 
      subscriptionId: subscription.id, 
      tenantId,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    }, 'Subscription updated webhook processed');

  } catch (error) {
    logger.error({ error, subscriptionId: subscription.id }, 'Handle subscription updated failed');
  }
}

/**
 * Manejar eliminación de suscripción
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  try {
    const tenantId = subscription.metadata.tenant_id;

    if (!tenantId) {
      logger.warn({ subscriptionId: subscription.id }, 'Missing tenant_id in subscription metadata');
      return;
    }

    // Actualizar suscripción en base de datos
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: 'canceled',
        ends_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('stripe_subscription_id', subscription.id);

    if (error) {
      logger.error({ error, subscriptionId: subscription.id }, 'Failed to update subscription in database');
      return;
    }

    // Obtener suscripción local
    const { data: localSubscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .eq('stripe_subscription_id', subscription.id)
      .single();

    if (localSubscription) {
      // Remover features del plan
      await subscriptionService.removePlanFeatures(tenantId, localSubscription.plan_id);

      // Notificar
      await notificationService.notifyTenantAdmins(tenantId, {
        type: 'subscription_canceled',
        title: 'Suscripción cancelada',
        message: `Tu suscripción a ${localSubscription.subscription_plans.display_name} ha sido cancelada`,
        data: {
          subscription_id: subscription.id,
          plan_name: localSubscription.subscription_plans.display_name,
          ended_at: new Date().toISOString()
        }
      });
    }

    logger.info({ 
      subscriptionId: subscription.id, 
      tenantId 
    }, 'Subscription deleted webhook processed');

  } catch (error) {
    logger.error({ error, subscriptionId: subscription.id }, 'Handle subscription deleted failed');
  }
}

/**
 * Manejar final próximo de trial
 */
async function handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
  try {
    const tenantId = subscription.metadata.tenant_id;

    if (!tenantId) {
      logger.warn({ subscriptionId: subscription.id }, 'Missing tenant_id in subscription metadata');
      return;
    }

    // Obtener información del tenant y plan
    const { data: localSubscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .eq('stripe_subscription_id', subscription.id)
      .single();

    if (!localSubscription) {
      logger.warn({ subscriptionId: subscription.id }, 'Local subscription not found');
      return;
    }

    const trialEndDate = new Date(subscription.trial_end! * 1000);
    const daysLeft = Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    // Notificar a admins del tenant
    await notificationService.notifyTenantAdmins(tenantId, {
      type: 'trial_ending',
      title: 'Tu período de prueba está terminando',
      message: `Tu trial de ${localSubscription.subscription_plans.display_name} termina en ${daysLeft} días`,
      priority: 'high',
      action_url: '/billing/subscriptions',
      action_label: 'Actualizar plan',
      data: {
        subscription_id: subscription.id,
        plan_name: localSubscription.subscription_plans.display_name,
        days_left: daysLeft,
        trial_end_date: trialEndDate.toISOString()
      }
    });

    logger.info({ 
      subscriptionId: subscription.id, 
      tenantId,
      daysLeft 
    }, 'Trial will end webhook processed');

  } catch (error) {
    logger.error({ error, subscriptionId: subscription.id }, 'Handle trial will end failed');
  }
}

/**
 * Manejar pago exitoso de factura
 */
async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  try {
    const subscriptionId = invoice.subscription as string;
    const customerId = invoice.customer as string;

    if (!subscriptionId) {
      logger.warn({ invoiceId: invoice.id }, 'Invoice not associated with subscription');
      return;
    }

    // Obtener tenant desde customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!tenant) {
      logger.warn({ invoiceId: invoice.id, customerId }, 'Tenant not found for customer');
      return;
    }

    // Crear/actualizar factura en base de datos
    await supabase
      .from('invoices')
      .upsert({
        stripe_invoice_id: invoice.id,
        tenant_id: tenant.id,
        invoice_number: invoice.number,
        amount_due: invoice.amount_due / 100,
        amount_paid: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: invoice.status,
        paid_at: invoice.status_transitions.paid_at 
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() 
          : null,
        pdf_url: invoice.invoice_pdf,
        hosted_invoice_url: invoice.hosted_invoice_url,
        description: invoice.description,
        due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
        created_at: new Date(invoice.created * 1000).toISOString()
      }, {
        onConflict: 'stripe_invoice_id'
      });

    // Obtener suscripción local
    const { data: localSubscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .eq('stripe_subscription_id', subscriptionId)
      .single();

    if (localSubscription) {
      // Notificar pago exitoso
      await notificationService.notifyTenantAdmins(tenant.id, {
        type: 'payment_succeeded',
        title: 'Pago procesado exitosamente',
        message: `Se ha procesado el pago de $${invoice.amount_paid / 100} ${invoice.currency.toUpperCase()}`,
        data: {
          invoice_id: invoice.id,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency,
          plan_name: localSubscription.subscription_plans.display_name
        }
      });
    }

    logger.info({ 
      invoiceId: invoice.id, 
      tenantId: tenant.id,
      amount: invoice.amount_paid / 100,
      currency: invoice.currency
    }, 'Invoice payment succeeded webhook processed');

  } catch (error) {
    logger.error({ error, invoiceId: invoice.id }, 'Handle invoice payment succeeded failed');
  }
}

/**
 * Manejar fallo en pago de factura
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  try {
    const subscriptionId = invoice.subscription as string;
    const customerId = invoice.customer as string;

    if (!subscriptionId) {
      logger.warn({ invoiceId: invoice.id }, 'Invoice not associated with subscription');
      return;
    }

    // Obtener tenant desde customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!tenant) {
      logger.warn({ invoiceId: invoice.id, customerId }, 'Tenant not found for customer');
      return;
    }

    // Actualizar factura en base de datos
    await supabase
      .from('invoices')
      .upsert({
        stripe_invoice_id: invoice.id,
        tenant_id: tenant.id,
        invoice_number: invoice.number,
        amount_due: invoice.amount_due / 100,
        amount_paid: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: invoice.status,
        description: invoice.description,
        due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
        created_at: new Date(invoice.created * 1000).toISOString()
      }, {
        onConflict: 'stripe_invoice_id'
      });

    // Obtener suscripción local
    const { data: localSubscription } = await supabase
      .from('subscriptions')
      .select('*, subscription_plans(*)')
      .eq('stripe_subscription_id', subscriptionId)
      .single();

    if (localSubscription) {
      // Notificar fallo en pago
      await notificationService.notifyTenantAdmins(tenant.id, {
        type: 'payment_failed',
        title: 'Error en el pago',
        message: `No se pudo procesar el pago de $${invoice.amount_due / 100} ${invoice.currency.toUpperCase()}`,
        priority: 'high',
        action_url: '/billing/payment-methods',
        action_label: 'Actualizar método de pago',
        data: {
          invoice_id: invoice.id,
          amount: invoice.amount_due / 100,
          currency: invoice.currency,
          plan_name: localSubscription.subscription_plans.display_name
        }
      });
    }

    logger.info({ 
      invoiceId: invoice.id, 
      tenantId: tenant.id,
      amount: invoice.amount_due / 100,
      currency: invoice.currency
    }, 'Invoice payment failed webhook processed');

  } catch (error) {
    logger.error({ error, invoiceId: invoice.id }, 'Handle invoice payment failed failed');
  }
}

/**
 * Manejar factura finalizada
 */
async function handleInvoiceFinalized(invoice: Stripe.Invoice): Promise<void> {
  try {
    const customerId = invoice.customer as string;

    // Obtener tenant desde customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!tenant) {
      logger.warn({ invoiceId: invoice.id, customerId }, 'Tenant not found for customer');
      return;
    }

    // Crear/actualizar factura en base de datos
    await supabase
      .from('invoices')
      .upsert({
        stripe_invoice_id: invoice.id,
        tenant_id: tenant.id,
        invoice_number: invoice.number,
        amount_due: invoice.amount_due / 100,
        amount_paid: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: invoice.status,
        description: invoice.description,
        pdf_url: invoice.invoice_pdf,
        hosted_invoice_url: invoice.hosted_invoice_url,
        due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
        created_at: new Date(invoice.created * 1000).toISOString()
      }, {
        onConflict: 'stripe_invoice_id'
      });

    logger.info({ 
      invoiceId: invoice.id, 
      tenantId: tenant.id 
    }, 'Invoice finalized webhook processed');

  } catch (error) {
    logger.error({ error, invoiceId: invoice.id }, 'Handle invoice finalized failed');
  }
}

/**
 * Manejar creación de customer
 */
async function handleCustomerCreated(customer: Stripe.Customer): Promise<void> {
  try {
    const tenantId = customer.metadata.tenant_id;

    if (!tenantId) {
      logger.warn({ customerId: customer.id }, 'Missing tenant_id in customer metadata');
      return;
    }

    // Actualizar tenant con customer ID
    await supabase
      .from('tenants')
      .update({
        stripe_customer_id: customer.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId);

    logger.info({ 
      customerId: customer.id, 
      tenantId 
    }, 'Customer created webhook processed');

  } catch (error) {
    logger.error({ error, customerId: customer.id }, 'Handle customer created failed');
  }
}

/**
 * Manejar actualización de customer
 */
async function handleCustomerUpdated(customer: Stripe.Customer): Promise<void> {
  try {
    const tenantId = customer.metadata.tenant_id;

    if (!tenantId) {
      logger.warn({ customerId: customer.id }, 'Missing tenant_id in customer metadata');
      return;
    }

    // Actualizar información del tenant si es necesario
    await supabase
      .from('tenants')
      .update({
        email: customer.email,
        updated_at: new Date().toISOString()
      })
      .eq('id', tenantId);

    logger.info({ 
      customerId: customer.id, 
      tenantId 
    }, 'Customer updated webhook processed');

  } catch (error) {
    logger.error({ error, customerId: customer.id }, 'Handle customer updated failed');
  }
}

/**
 * Manejar método de pago adjuntado
 */
async function handlePaymentMethodAttached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
  try {
    const customerId = paymentMethod.customer as string;

    if (!customerId) {
      logger.warn({ paymentMethodId: paymentMethod.id }, 'Payment method not associated with customer');
      return;
    }

    // Obtener tenant desde customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!tenant) {
      logger.warn({ paymentMethodId: paymentMethod.id, customerId }, 'Tenant not found for customer');
      return;
    }

    // Crear/actualizar método de pago en base de datos
    await supabase
      .from('payment_methods')
      .upsert({
        stripe_payment_method_id: paymentMethod.id,
        tenant_id: tenant.id,
        type: paymentMethod.type,
        last_four: paymentMethod.card?.last4,
        brand: paymentMethod.card?.brand,
        exp_month: paymentMethod.card?.exp_month,
        exp_year: paymentMethod.card?.exp_year,
        active: true,
        created_at: new Date(paymentMethod.created * 1000).toISOString()
      }, {
        onConflict: 'stripe_payment_method_id'
      });

    logger.info({ 
      paymentMethodId: paymentMethod.id, 
      tenantId: tenant.id 
    }, 'Payment method attached webhook processed');

  } catch (error) {
    logger.error({ error, paymentMethodId: paymentMethod.id }, 'Handle payment method attached failed');
  }
}

/**
 * Manejar método de pago desvinculado
 */
async function handlePaymentMethodDetached(paymentMethod: Stripe.PaymentMethod): Promise<void> {
  try {
    // Desactivar método de pago en base de datos
    await supabase
      .from('payment_methods')
      .update({
        active: false,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_payment_method_id', paymentMethod.id);

    logger.info({ 
      paymentMethodId: paymentMethod.id 
    }, 'Payment method detached webhook processed');

  } catch (error) {
    logger.error({ error, paymentMethodId: paymentMethod.id }, 'Handle payment method detached failed');
  }
}

/**
 * Manejar setup intent exitoso
 */
async function handleSetupIntentSucceeded(setupIntent: Stripe.SetupIntent): Promise<void> {
  try {
    const customerId = setupIntent.customer as string;
    const paymentMethodId = setupIntent.payment_method as string;

    if (!customerId || !paymentMethodId) {
      logger.warn({ setupIntentId: setupIntent.id }, 'Missing customer or payment method in setup intent');
      return;
    }

    // Obtener tenant desde customer
    const { data: tenant } = await supabase
      .from('tenants')
      .select('*')
      .eq('stripe_customer_id', customerId)
      .single();

    if (!tenant) {
      logger.warn({ setupIntentId: setupIntent.id, customerId }, 'Tenant not found for customer');
      return;
    }

    // Marcar método de pago como verificado
    await supabase
      .from('payment_methods')
      .update({
        verified: true,
        updated_at: new Date().toISOString()
      })
      .eq('stripe_payment_method_id', paymentMethodId);

    // Notificar que el método de pago está listo
    await notificationService.notifyTenantAdmins(tenant.id, {
      type: 'payment_method_verified',
      title: 'Método de pago verificado',
      message: 'Tu método de pago ha sido verificado exitosamente',
      data: {
        payment_method_id: paymentMethodId,
        setup_intent_id: setupIntent.id
      }
    });

    logger.info({ 
      setupIntentId: setupIntent.id, 
      tenantId: tenant.id,
      paymentMethodId 
    }, 'Setup intent succeeded webhook processed');

  } catch (error) {
    logger.error({ error, setupIntentId: setupIntent.id }, 'Handle setup intent succeeded failed');
  }
}

export const handleGithubWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const event = req.headers['x-github-event'] as string;
    const signature = req.headers['x-github-signature-256'] as string;
    const payload = req.body;

    // Verificar firma
    const crypto = require('crypto');
    const expectedSignature = `sha256=${crypto
      .createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET!)
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    if (signature !== expectedSignature) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Procesar eventos
    logger.info({ event, repository: payload.repository?.name }, 'GitHub webhook received');

    // TODO: Implementar procesamiento específico según el evento

    res.json({ received: true });
  } catch (error: any) {
    logger.error({ error: error.message }, 'GitHub webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

export const handleCustomWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { webhookId } = req.params;
    const payload = req.body;

    await webhookService.processIncomingWebhook(webhookId, payload);

    res.json({ received: true });
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      webhookId: req.params.webhookId
    }, 'Custom webhook processing error');
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};
