import Stripe from 'stripe'
import stripe, { STRIPE_CONFIG } from '../config/stripe.js'
import { supabase } from '../config/database.js'
import type { 
  CreateCustomerRequest, 
  CreateSubscriptionRequest, 
  BillingInfo,
  Subscription,
  Company 
} from '../types/index.js'

export class BillingService {
  
  private get stripeClient(): Stripe {
    if (!stripe) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY and ENABLE_STRIPE=true')
    }
    return stripe
  }
  
  /**
   * Create or retrieve Stripe customer for a company
   */
  async createOrGetCustomer(companyId: string, customerData: CreateCustomerRequest): Promise<Stripe.Customer> {
    try {
      // Check if customer already exists in our database
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('stripe_customer_id, razon_social, billing_email')
        .eq('id', companyId)
        .single()

      if (companyError) {
        throw new Error(`Company not found: ${companyError.message}`)
      }

      // If Stripe customer already exists, return it
      if (company.stripe_customer_id) {
        const customer = await this.stripeClient.customers.retrieve(company.stripe_customer_id)
        if (customer && !customer.deleted) {
          return customer as Stripe.Customer
        }
      }

      // Create new Stripe customer
      const customer = await this.stripeClient.customers.create({
        email: customerData.email || company.billing_email,
        name: customerData.name || company.razon_social,
        phone: customerData.phone,
        address: customerData.address ? {
          line1: customerData.address.line1,
          line2: customerData.address.line2,
          city: customerData.address.city,
          state: customerData.address.state,
          postal_code: customerData.address.postal_code,
          country: customerData.address.country,
        } : undefined,
        metadata: {
          company_id: companyId,
          created_via: 'forvara_hub',
        },
      })

      // Update company with Stripe customer ID
      await supabase
        .from('companies')
        .update({ 
          stripe_customer_id: customer.id,
          billing_email: customer.email || company.billing_email,
        })
        .eq('id', companyId)

      return customer
    } catch (error) {
      console.error('Error creating/getting Stripe customer:', error)
      throw new Error(`Failed to create customer: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Create a checkout session for app subscription
   */
  async createCheckoutSession(
    companyId: string, 
    appId: string, 
    planName: string,
    priceId: string,
    customerData: CreateCustomerRequest,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      // Create or get customer
      const customer = await this.createOrGetCustomer(companyId, customerData)

      // Get app information
      const { data: app, error: appError } = await supabase
        .from('apps')
        .select('name, description')
        .eq('id', appId)
        .single()

      if (appError || !app) {
        throw new Error('App not found')
      }

      // Create checkout session
      const session = await this.stripeClient.checkout.sessions.create({
        customer: customer.id,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          trial_period_days: STRIPE_CONFIG.TRIAL_PERIOD_DAYS,
          metadata: {
            company_id: companyId,
            app_id: appId,
            plan_name: planName,
          },
        },
        metadata: {
          company_id: companyId,
          app_id: appId,
          plan_name: planName,
        },
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        automatic_tax: {
          enabled: true,
        },
      })

      return session
    } catch (error) {
      console.error('Error creating checkout session:', error)
      throw new Error(`Failed to create checkout session: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Create subscription directly (for admin or API use)
   */
  async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
    try {
      // Create or get customer
      const customer = await this.createOrGetCustomer(request.company_id, {
        email: request.customer_email,
        name: request.customer_name,
      })

      // Create Stripe subscription
      const stripeSubscription = await this.stripeClient.subscriptions.create({
        customer: customer.id,
        items: [
          {
            price: request.price_id,
            quantity: 1,
          },
        ],
        trial_period_days: request.trial_days || STRIPE_CONFIG.TRIAL_PERIOD_DAYS,
        metadata: {
          company_id: request.company_id,
          app_id: request.app_id,
          plan_name: request.plan_name,
        },
      })

      // Create subscription in our database
      const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .insert({
          company_id: request.company_id,
          app_id: request.app_id,
          plan_name: request.plan_name,
          billing_cycle: request.billing_cycle,
          price_monthly: request.price_monthly,
          status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
          stripe_subscription_id: stripeSubscription.id,
          stripe_customer_id: customer.id,
          current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
          trial_ends_at: stripeSubscription.trial_end ? 
            new Date(stripeSubscription.trial_end * 1000).toISOString() : null,
        })
        .select()
        .single()

      if (subError) {
        throw new Error(`Failed to create subscription in database: ${subError.message}`)
      }

      return subscription
    } catch (error) {
      console.error('Error creating subscription:', error)
      throw new Error(`Failed to create subscription: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId: string, immediately = false): Promise<void> {
    try {
      // Get subscription from database
      const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .select('stripe_subscription_id, company_id')
        .eq('id', subscriptionId)
        .single()

      if (subError || !subscription) {
        throw new Error('Subscription not found')
      }

      // Cancel in Stripe
      if (immediately) {
        await this.stripeClient.subscriptions.cancel(subscription.stripe_subscription_id)
      } else {
        await this.stripeClient.subscriptions.update(subscription.stripe_subscription_id, {
          cancel_at_period_end: true,
        })
      }

      // Update in our database
      await supabase
        .from('subscriptions')
        .update({
          status: immediately ? 'canceled' : 'active',
          cancel_at_period_end: !immediately,
          canceled_at: immediately ? new Date().toISOString() : null,
        })
        .eq('id', subscriptionId)

    } catch (error) {
      console.error('Error canceling subscription:', error)
      throw new Error(`Failed to cancel subscription: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Get customer portal URL
   */
  async createCustomerPortalSession(companyId: string, returnUrl: string): Promise<string> {
    try {
      // Get company's Stripe customer ID
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select('stripe_customer_id')
        .eq('id', companyId)
        .single()

      if (companyError || !company?.stripe_customer_id) {
        throw new Error('Company or Stripe customer not found')
      }

      // Create portal session
      const session = await this.stripeClient.billingPortal.sessions.create({
        customer: company.stripe_customer_id,
        return_url: returnUrl,
      })

      return session.url
    } catch (error) {
      console.error('Error creating customer portal session:', error)
      throw new Error(`Failed to create portal session: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * Handle Stripe webhooks
   */
  async handleWebhook(event: Stripe.Event): Promise<void> {
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
          break

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
          break

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice)
          break

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object as Stripe.Invoice)
          break

        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
          break

        default:
          console.log(`Unhandled event type: ${event.type}`)
      }
    } catch (error) {
      console.error('Error handling webhook:', error)
      throw error
    }
  }

  private async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        trial_ends_at: subscription.trial_end ? 
          new Date(subscription.trial_end * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
      })
      .eq('stripe_subscription_id', subscription.id)

    if (error) {
      throw new Error(`Failed to update subscription: ${error.message}`)
    }
  }

  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
      })
      .eq('stripe_subscription_id', subscription.id)

    if (error) {
      throw new Error(`Failed to mark subscription as canceled: ${error.message}`)
    }
  }

  private async handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    // Update payment in database, send success email, etc.
    console.log('Payment succeeded for invoice:', invoice.id)
  }

  private async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    // Handle failed payment, send notification, etc.
    console.log('Payment failed for invoice:', invoice.id)
  }

  private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    // Handle successful checkout completion
    console.log('Checkout completed for session:', session.id)
  }

  /**
   * Get subscription usage and billing information
   */
  async getBillingInfo(companyId: string): Promise<BillingInfo> {
    try {
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .select(`
          *,
          subscriptions:subscriptions(*)
        `)
        .eq('id', companyId)
        .single()

      if (companyError) {
        throw new Error(`Company not found: ${companyError.message}`)
      }

      // Calculate total monthly cost
      const totalMonthlyCost = company.subscriptions?.reduce((total: number, sub: any) => {
        return total + (sub.status === 'active' || sub.status === 'trialing' ? sub.price_monthly : 0)
      }, 0) || 0

      // Get Stripe customer if exists
      let paymentMethods: Stripe.PaymentMethod[] = []
      if (company.stripe_customer_id) {
        const methods = await this.stripeClient.paymentMethods.list({
          customer: company.stripe_customer_id,
          type: 'card',
        })
        paymentMethods = methods.data
      }

      return {
        company_id: companyId,
        stripe_customer_id: company.stripe_customer_id,
        billing_email: company.billing_email,
        total_monthly_cost: totalMonthlyCost,
        subscriptions: company.subscriptions || [],
        payment_methods: paymentMethods,
        trial_ends_at: company.trial_ends_at,
        billing_address: company.billing_address,
      }
    } catch (error) {
      console.error('Error getting billing info:', error)
      throw new Error(`Failed to get billing info: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}