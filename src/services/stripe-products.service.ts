import stripe, { STRIPE_CONFIG } from '../config/stripe.js'
import { supabase } from '../config/database.js'

/**
 * Service to manage Stripe products and prices for Forvara apps
 * Creates and manages products with LATAM-specific pricing
 */
export class StripeProductsService {

  private get stripeClient(): Stripe {
    if (!stripe) {
      throw new Error('Stripe is not configured. Please set STRIPE_SECRET_KEY and ENABLE_STRIPE=true')
    }
    return stripe
  }

  /**
   * Initialize Stripe products for all apps in the database
   * This should be run when setting up the system
   */
  async initializeAllProducts(): Promise<void> {
    try {
      // Get all apps from database
      const { data: apps, error } = await supabase
        .from('apps')
        .select('*')
        .eq('is_active', true)

      if (error) {
        throw new Error(`Failed to fetch apps: ${error.message}`)
      }

      for (const app of apps || []) {
        await this.createOrUpdateStripeProduct(app)
      }

      console.log('✅ All Stripe products initialized successfully')
    } catch (error) {
      console.error('❌ Error initializing Stripe products:', error)
      throw error
    }
  }

  /**
   * Create or update a Stripe product for a Forvara app
   */
  async createOrUpdateStripeProduct(app: any): Promise<string> {
    try {
      // Check if product already exists
      let product
      if (app.stripe_product_id) {
        try {
          product = await this.stripeClient.products.retrieve(app.stripe_product_id)
        } catch (error) {
          console.log(`Product ${app.stripe_product_id} not found, creating new one`)
          product = null
        }
      }

      // Create or update product
      if (!product) {
        product = await this.stripeClient.products.create({
          name: app.display_name || app.name,
          description: app.description,
          images: app.icon_url ? [app.icon_url] : [],
          metadata: {
            app_id: app.id,
            category: app.category,
            version: app.version,
          },
          type: 'service',
          active: app.is_active,
        })

        // Update app with Stripe product ID
        await supabase
          .from('apps')
          .update({ stripe_product_id: product.id })
          .eq('id', app.id)
      } else {
        // Update existing product
        product = await this.stripeClient.products.update(app.stripe_product_id, {
          name: app.display_name || app.name,
          description: app.description,
          images: app.icon_url ? [app.icon_url] : [],
          metadata: {
            app_id: app.id,
            category: app.category,
            version: app.version,
          },
          active: app.is_active,
        })
      }

      // Create prices for the product
      await this.createPricesForProduct(product.id, app)

      return product.id
    } catch (error) {
      console.error(`Error creating/updating Stripe product for app ${app.id}:`, error)
      throw error
    }
  }

  /**
   * Create pricing plans for a Stripe product
   */
  private async createPricesForProduct(productId: string, app: any): Promise<void> {
    try {
      // Define pricing plans for the app
      const pricingPlans = [
        {
          nickname: `${app.name} - Monthly`,
          billing_cycle: 'monthly',
          unit_amount: Math.round(app.base_price_monthly * 100), // Convert to cents
          currency: 'usd', // Primary currency for LATAM
          metadata: {
            app_id: app.id,
            plan_type: 'monthly',
            trial_days: STRIPE_CONFIG.TRIAL_PERIOD_DAYS.toString(),
          },
        },
        {
          nickname: `${app.name} - Yearly (20% off)`,
          billing_cycle: 'yearly',
          unit_amount: Math.round(app.base_price_monthly * 12 * 0.8 * 100), // 20% discount
          currency: 'usd',
          metadata: {
            app_id: app.id,
            plan_type: 'yearly',
            trial_days: STRIPE_CONFIG.TRIAL_PERIOD_DAYS.toString(),
          },
        },
      ]

      // Only create prices if app is not free
      if (!app.is_free && app.base_price_monthly > 0) {
        for (const plan of pricingPlans) {
          // Check if price already exists
          const existingPrices = await this.stripeClient.prices.list({
            product: productId,
            active: true,
            lookup_keys: [`${app.id}-${plan.billing_cycle}`],
          })

          if (existingPrices.data.length === 0) {
            await this.stripeClient.prices.create({
              product: productId,
              nickname: plan.nickname,
              currency: plan.currency,
              unit_amount: plan.unit_amount,
              recurring: {
                interval: plan.billing_cycle as 'month' | 'year',
                trial_period_days: STRIPE_CONFIG.TRIAL_PERIOD_DAYS,
              },
              lookup_key: `${app.id}-${plan.billing_cycle}`,
              metadata: plan.metadata,
            })
          }
        }
      }
    } catch (error) {
      console.error(`Error creating prices for product ${productId}:`, error)
      throw error
    }
  }

  /**
   * Get all prices for an app
   */
  async getAppPrices(appId: string): Promise<any[]> {
    try {
      // Get app's Stripe product ID
      const { data: app, error } = await supabase
        .from('apps')
        .select('stripe_product_id')
        .eq('id', appId)
        .single()

      if (error || !app?.stripe_product_id) {
        return []
      }

      // Get all prices for the product
      const prices = await this.stripeClient.prices.list({
        product: app.stripe_product_id,
        active: true,
        expand: ['data.product'],
      })

      return prices.data.map(price => ({
        id: price.id,
        nickname: price.nickname,
        unit_amount: price.unit_amount,
        currency: price.currency,
        billing_cycle: price.recurring?.interval,
        trial_period_days: price.recurring?.trial_period_days,
        lookup_key: price.lookup_key,
        metadata: price.metadata,
      }))
    } catch (error) {
      console.error(`Error getting prices for app ${appId}:`, error)
      return []
    }
  }

  /**
   * Create a one-time setup price for enterprise customers
   */
  async createSetupPrice(appId: string, amount: number, description: string): Promise<string> {
    try {
      const { data: app, error } = await supabase
        .from('apps')
        .select('stripe_product_id, name')
        .eq('id', appId)
        .single()

      if (error || !app?.stripe_product_id) {
        throw new Error('App or Stripe product not found')
      }

      const price = await this.stripeClient.prices.create({
        product: app.stripe_product_id,
        nickname: `${app.name} - Setup Fee`,
        currency: 'usd',
        unit_amount: Math.round(amount * 100),
        lookup_key: `${appId}-setup`,
        metadata: {
          app_id: appId,
          plan_type: 'setup',
          description: description,
        },
      })

      return price.id
    } catch (error) {
      console.error(`Error creating setup price for app ${appId}:`, error)
      throw error
    }
  }

  /**
   * Deactivate all prices for an app (when app is discontinued)
   */
  async deactivateAppPrices(appId: string): Promise<void> {
    try {
      const { data: app, error } = await supabase
        .from('apps')
        .select('stripe_product_id')
        .eq('id', appId)
        .single()

      if (error || !app?.stripe_product_id) {
        return
      }

      const prices = await this.stripeClient.prices.list({
        product: app.stripe_product_id,
        active: true,
      })

      for (const price of prices.data) {
        await this.stripeClient.prices.update(price.id, { active: false })
      }

      // Also deactivate the product
      await this.stripeClient.products.update(app.stripe_product_id, { active: false })
    } catch (error) {
      console.error(`Error deactivating prices for app ${appId}:`, error)
      throw error
    }
  }

  /**
   * Get pricing recommendations for LATAM markets
   */
  async getLATAMPricingRecommendations(baseUSDPrice: number): Promise<any> {
    // Simplified pricing recommendations based on market research
    // In a real implementation, you'd use economic data APIs
    return {
      USD: baseUSDPrice,
      markets: {
        Panama: {
          currency: 'USD',
          recommended_price: baseUSDPrice,
          note: 'USD is the official currency',
        },
        Mexico: {
          currency: 'MXN',
          recommended_price: baseUSDPrice * 18, // Approximate exchange rate
          note: 'Adjust for local purchasing power',
        },
        Colombia: {
          currency: 'COP',
          recommended_price: baseUSDPrice * 4000,
          note: 'Consider local competition',
        },
        Brazil: {
          currency: 'BRL',
          recommended_price: baseUSDPrice * 5.2,
          note: 'High purchasing power market',
        },
      },
    }
  }
}