import express from 'express'
import { BillingService } from '../services/billing.service.js'
import { authenticate } from '../middleware/auth.js'
import { individualOrCompanyMode } from '../middleware/tenant.js'
import stripe, { STRIPE_CONFIG } from '../config/stripe.js'
import { successResponse, errorResponse } from '../utils/responses.js'
import { AuthRequest } from '../types/index.js'
import { z } from 'zod'

const router = express.Router()
const billingService = new BillingService()

// Apply authentication and individual/company mode middleware to all routes
router.use(authenticate)
router.use(individualOrCompanyMode)

// Validation schemas
const CreateCheckoutSchema = z.object({
  app_id: z.string().uuid(),
  plan_name: z.string(),
  price_id: z.string(),
  customer_data: z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      postal_code: z.string(),
      country: z.string(),
    }).optional(),
  }),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
})

const CreateSubscriptionSchema = z.object({
  app_id: z.string().uuid(),
  plan_name: z.string(),
  price_id: z.string(),
  billing_cycle: z.enum(['monthly', 'yearly', 'one_time']),
  price_monthly: z.number().positive(),
  customer_email: z.string().email(),
  customer_name: z.string(),
  trial_days: z.number().optional(),
})

/**
 * POST /api/billing/checkout
 * Create Stripe checkout session for app subscription
 */
router.post('/checkout', async (req: AuthRequest, res) => {
  try {
    const company_id = req.user?.company_id
    const user_id = req.user?.id
    const is_individual = req.user?.is_individual_mode
    
    if (!company_id && !is_individual) {
      return res.status(400).json(errorResponse('Company ID required for company mode'))
    }
    
    const body = CreateCheckoutSchema.parse(req.body)

    const session = await billingService.createCheckoutSession(
      company_id,
      body.app_id,
      body.plan_name,
      body.price_id,
      body.customer_data,
      body.success_url,
      body.cancel_url,
      is_individual ? user_id : undefined
    )

    res.json(successResponse({
      checkout_url: session.url,
      session_id: session.id,
    }))
  } catch (error) {
    console.error('Checkout creation error:', error)
    res.status(400).json(errorResponse(
      error instanceof Error ? error.message : 'Failed to create checkout session'
    ))
  }
})

/**
 * POST /api/billing/subscriptions
 * Create subscription directly (admin use)
 */
router.post('/subscriptions', async (req: AuthRequest, res) => {
  try {
    const company_id = req.user?.company_id
    const user_id = req.user?.id
    const is_individual = req.user?.is_individual_mode
    
    if (!company_id && !is_individual) {
      return res.status(400).json(errorResponse('Company ID required for company mode'))
    }
    
    const body = CreateSubscriptionSchema.parse(req.body)

    const subscription = await billingService.createSubscription({
      company_id: is_individual ? null : company_id,
      user_id: is_individual ? user_id : undefined,
      app_id: body.app_id,
      plan_name: body.plan_name,
      price_id: body.price_id,
      billing_cycle: body.billing_cycle,
      price_monthly: body.price_monthly,
      customer_email: body.customer_email,
      customer_name: body.customer_name,
      trial_days: body.trial_days,
    })

    res.json(successResponse(subscription))
  } catch (error) {
    console.error('Subscription creation error:', error)
    res.status(400).json(errorResponse(
      error instanceof Error ? error.message : 'Failed to create subscription'
    ))
  }
})

/**
 * DELETE /api/billing/subscriptions/:id
 * Cancel subscription
 */
router.delete('/subscriptions/:id', async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const { immediately = false } = req.query

    await billingService.cancelSubscription(id, immediately === 'true')

    res.json(successResponse({ message: 'Subscription canceled successfully' }))
  } catch (error) {
    console.error('Subscription cancellation error:', error)
    res.status(400).json(errorResponse(
      error instanceof Error ? error.message : 'Failed to cancel subscription'
    ))
  }
})

/**
 * GET /api/billing/info
 * Get billing information for company or individual user
 */
router.get('/info', async (req: AuthRequest, res) => {
  try {
    const company_id = req.user?.company_id
    const user_id = req.user?.id
    const is_individual = req.user?.is_individual_mode
    
    if (!company_id && !is_individual) {
      return res.status(400).json(errorResponse('Company ID required for company mode'))
    }
    
    const billingInfo = await billingService.getBillingInfo(is_individual ? null : company_id, is_individual ? user_id : undefined)

    res.json(successResponse(billingInfo))
  } catch (error) {
    console.error('Billing info error:', error)
    res.status(400).json(errorResponse(
      error instanceof Error ? error.message : 'Failed to get billing information'
    ))
  }
})

/**
 * POST /api/billing/portal
 * Create customer portal session
 */
router.post('/portal', async (req: AuthRequest, res) => {
  try {
    const company_id = req.user?.company_id
    const user_id = req.user?.id
    const is_individual = req.user?.is_individual_mode
    
    if (!company_id && !is_individual) {
      return res.status(400).json(errorResponse('Company ID required for company mode'))
    }
    
    const { return_url } = req.body

    if (!return_url) {
      return res.status(400).json(errorResponse('return_url is required'))
    }

    const portalUrl = await billingService.createCustomerPortalSession(is_individual ? null : company_id, return_url, is_individual ? user_id : undefined)

    res.json(successResponse({ portal_url: portalUrl }))
  } catch (error) {
    console.error('Portal creation error:', error)
    res.status(400).json(errorResponse(
      error instanceof Error ? error.message : 'Failed to create portal session'
    ))
  }
})

/**
 * POST /api/billing/webhooks
 * Handle Stripe webhooks
 */
router.post('/webhooks', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('Stripe webhook secret not configured')
    return res.status(400).json(errorResponse('Webhook secret not configured'))
  }

  try {
    // Check if Stripe is configured
    if (!stripe) {
      return res.status(500).json(errorResponse('Stripe is not configured'))
    }
    
    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)

    // Handle the event
    await billingService.handleWebhook(event)

    res.json({ received: true })
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    res.status(400).json(errorResponse('Invalid webhook signature'))
  }
})

/**
 * GET /api/billing/config
 * Get Stripe configuration for frontend
 */
router.get('/config', authenticate, async (req: AuthRequest, res) => {
  try {
    res.json(successResponse({
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
      supported_currencies: STRIPE_CONFIG.CURRENCIES,
      supported_countries: STRIPE_CONFIG.SUPPORTED_COUNTRIES,
      trial_period_days: STRIPE_CONFIG.TRIAL_PERIOD_DAYS,
    }))
  } catch (error) {
    console.error('Config error:', error)
    res.status(500).json(errorResponse('Failed to get billing configuration'))
  }
})

export { router as billingRoutes }