import Stripe from 'stripe';
import { config } from '../config';
import { logger } from '../config/logger';
import { getSupabase } from '../config/database';
import { 
  PaymentMethod,
  StripeCustomer,
  StripeProduct,
  StripePrice
} from '../types';

const stripe = new Stripe(config.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
  typescript: true
});

const supabase = getSupabase();

class StripeService {
  /**
   * Crear o actualizar cliente
   */
  async createOrUpdateCustomer(params: {
    tenantId: string;
    email: string;
    name: string;
    metadata?: Record<string, string>;
  }): Promise<StripeCustomer> {
    try {
      const { tenantId, email, name, metadata = {} } = params;

      // Buscar si ya existe
      const { data: tenant } = await supabase
        .from('tenants')
        .select('stripe_customer_id')
        .eq('id', tenantId)
        .single();

      let customer: Stripe.Customer;

      if (tenant?.stripe_customer_id) {
        // Actualizar existente
        customer = await stripe.customers.update(tenant.stripe_customer_id, {
          email,
          name,
          metadata: {
            ...metadata,
            tenant_id: tenantId
          }
        });
      } else {
        // Crear nuevo
        customer = await stripe.customers.create({
          email,
          name,
          metadata: {
            ...metadata,
            tenant_id: tenantId
          }
        });

        // Guardar ID en BD
        await supabase
          .from('tenants')
          .update({ stripe_customer_id: customer.id })
          .eq('id', tenantId);
      }

      logger.info({ 
        customerId: customer.id, 
        tenantId 
      }, 'Stripe customer created/updated');

      return customer as StripeCustomer;
    } catch (error) {
      logger.error({ error, params }, 'Create/update customer failed');
      throw error;
    }
  }

  /**
   * Crear método de pago
   */
  async attachPaymentMethod(
    customerId: string,
    paymentMethodId: string
  ): Promise<PaymentMethod> {
    try {
      // Adjuntar método de pago
      const paymentMethod = await stripe.paymentMethods.attach(
        paymentMethodId,
        { customer: customerId }
      );

      // Establecer como predeterminado
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });

      logger.info({ 
        customerId, 
        paymentMethodId 
      }, 'Payment method attached');

      return paymentMethod as PaymentMethod;
    } catch (error) {
      logger.error({ error, customerId, paymentMethodId }, 'Attach payment method failed');
      throw error;
    }
  }

  /**
   * Listar métodos de pago
   */
  async listPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    try {
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card'
      });

      return paymentMethods.data as PaymentMethod[];
    } catch (error) {
      logger.error({ error, customerId }, 'List payment methods failed');
      throw error;
    }
  }

  /**
   * Crear producto
   */
  async createProduct(params: {
    name: string;
    description?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeProduct> {
    try {
      const product = await stripe.products.create({
        name: params.name,
        description: params.description,
        metadata: params.metadata
      });

      logger.info({ productId: product.id }, 'Product created');

      return product as StripeProduct;
    } catch (error) {
      logger.error({ error, params }, 'Create product failed');
      throw error;
    }
  }

  /**
   * Crear precio
   */
  async createPrice(params: {
    productId: string;
    unitAmount: number;
    currency?: string;
    recurring?: {
      interval: 'month' | 'year';
      intervalCount?: number;
    };
    metadata?: Record<string, string>;
  }): Promise<StripePrice> {
    try {
      const price = await stripe.prices.create({
        product: params.productId,
        unit_amount: params.unitAmount,
        currency: params.currency || 'usd',
        recurring: params.recurring,
        metadata: params.metadata
      });

      logger.info({ priceId: price.id }, 'Price created');

      return price as StripePrice;
    } catch (error) {
      logger.error({ error, params }, 'Create price failed');
      throw error;
    }
  }

  /**
   * Crear suscripción
   */
  async createSubscription(params: {
    customerId: string;
    priceId: string;
    quantity?: number;
    trialDays?: number;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Subscription> {
    try {
      const subscription = await stripe.subscriptions.create({
        customer: params.customerId,
        items: [{
          price: params.priceId,
          quantity: params.quantity || 1
        }],
        trial_period_days: params.trialDays,
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription'
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: params.metadata
      });

      logger.info({ 
        subscriptionId: subscription.id,
        customerId: params.customerId 
      }, 'Subscription created');

      return subscription;
    } catch (error) {
      logger.error({ error, params }, 'Create subscription failed');
      throw error;
    }
  }

  /**
   * Cancelar suscripción
   */
  async cancelSubscription(
    subscriptionId: string,
    immediately?: boolean
  ): Promise<Stripe.Subscription> {
    try {
      const subscription = immediately
        ? await stripe.subscriptions.del(subscriptionId)
        : await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true
          });

      logger.info({ 
        subscriptionId,
        immediately 
      }, 'Subscription cancelled');

      return subscription;
    } catch (error) {
      logger.error({ error, subscriptionId }, 'Cancel subscription failed');
      throw error;
    }
  }

  /**
   * Crear sesión de checkout
   */
  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    quantity?: number;
    successUrl: string;
    cancelUrl: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Checkout.Session> {
    try {
      const session = await stripe.checkout.sessions.create({
        customer: params.customerId,
        line_items: [{
          price: params.priceId,
          quantity: params.quantity || 1
        }],
        mode: 'subscription',
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        payment_method_types: ['card'],
        billing_address_collection: 'required',
        metadata: params.metadata
      });

      logger.info({ 
        sessionId: session.id,
        customerId: params.customerId 
      }, 'Checkout session created');

      return session;
    } catch (error) {
      logger.error({ error, params }, 'Create checkout session failed');
      throw error;
    }
  }

  /**
   * Crear portal de facturación
   */
  async createBillingPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<Stripe.BillingPortal.Session> {
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: params.customerId,
        return_url: params.returnUrl
      });

      logger.info({ 
        sessionId: session.id,
        customerId: params.customerId 
      }, 'Billing portal session created');

      return session;
    } catch (error) {
      logger.error({ error, params }, 'Create billing portal session failed');
      throw error;
    }
  }

  /**
   * Obtener facturas
   */
  async listInvoices(
    customerId: string,
    limit?: number
  ): Promise<Stripe.Invoice[]> {
    try {
      const invoices = await stripe.invoices.list({
        customer: customerId,
        limit: limit || 10
      });

      return invoices.data;
    } catch (error) {
      logger.error({ error, customerId }, 'List invoices failed');
      throw error;
    }
  }

  /**
   * Crear reembolso
   */
  async createRefund(params: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: Record<string, string>;
  }): Promise<Stripe.Refund> {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: params.paymentIntentId,
        amount: params.amount,
        reason: params.reason as Stripe.RefundCreateParams.Reason,
        metadata: params.metadata
      });

      logger.info({ 
        refundId: refund.id,
        paymentIntentId: params.paymentIntentId 
      }, 'Refund created');

      return refund;
    } catch (error) {
      logger.error({ error, params }, 'Create refund failed');
      throw error;
    }
  }

  /**
   * Verificar webhook signature
   */
  verifyWebhookSignature(
    payload: string | Buffer,
    signature: string
  ): Stripe.Event {
    try {
      return stripe.webhooks.constructEvent(
        payload,
        signature,
        config.STRIPE_WEBHOOK_SECRET!
      );
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification failed');
      throw error;
    }
  }

  /**
   * Sincronizar planes desde Stripe
   */
  async syncPlansFromStripe(): Promise<void> {
    try {
      // Obtener productos activos
      const products = await stripe.products.list({
        active: true,
        limit: 100
      });

      for (const product of products.data) {
        // Obtener precios del producto
        const prices = await stripe.prices.list({
          product: product.id,
          active: true
        });

        for (const price of prices.data) {
          // Guardar o actualizar en BD
          await supabase
            .from('subscription_plans')
            .upsert({
              stripe_product_id: product.id,
              stripe_price_id: price.id,
              name: product.name,
              description: product.description,
              price_monthly: price.recurring?.interval === 'month' 
                ? (price.unit_amount || 0) / 100 
                : null,
              price_yearly: price.recurring?.interval === 'year'
                ? (price.unit_amount || 0) / 100
                : null,
              currency: price.currency,
              is_active: product.active && price.active,
              metadata: {
                ...product.metadata,
                ...price.metadata
              }
            }, {
              onConflict: 'stripe_price_id'
            });
        }
      }

      logger.info({ 
        productCount: products.data.length 
      }, 'Plans synced from Stripe');
    } catch (error) {
      logger.error({ error }, 'Sync plans from Stripe failed');
      throw error;
    }
  }
}

export const stripeService = new StripeService();
