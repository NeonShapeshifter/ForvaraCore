import Stripe from 'stripe'

// Initialize Stripe with API key (only if configured)
let stripe: Stripe | null = null

if (process.env.STRIPE_SECRET_KEY && process.env.ENABLE_STRIPE === 'true') {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-06-30.basil',
    typescript: true,
    telemetry: false, // Disable telemetry for enterprise use
  })
  console.log('✅ Stripe initialized successfully')
} else {
  console.log('⚠️  Stripe not configured (set STRIPE_SECRET_KEY and ENABLE_STRIPE=true)')
}

export default stripe

// Stripe configuration for LATAM
export const STRIPE_CONFIG = {
  // Supported currencies for LATAM
  CURRENCIES: {
    USD: 'usd', // United States Dollar
    PAB: 'usd', // Panama uses USD
    MXN: 'mxn', // Mexican Peso
    COP: 'cop', // Colombian Peso
    CRC: 'crc', // Costa Rican Colón
    GTQ: 'gtq', // Guatemalan Quetzal
    BRL: 'brl', // Brazilian Real
    ARS: 'ars', // Argentine Peso
    CLP: 'clp', // Chilean Peso
    PEN: 'pen', // Peruvian Sol
    UYU: 'uyu', // Uruguayan Peso
  },
  
  // Stripe Connect countries (where Stripe is available)
  SUPPORTED_COUNTRIES: [
    'PA', // Panama
    'MX', // Mexico
    'CO', // Colombia
    'CR', // Costa Rica
    'GT', // Guatemala
    'BR', // Brazil
    'AR', // Argentina
    'CL', // Chile
    'PE', // Peru
    'UY', // Uruguay
  ],
  
  // Payment methods available in LATAM
  PAYMENT_METHODS: ['card', 'oxxo', 'alipay'], // More can be added per country
  
  // Default trial period for subscriptions
  TRIAL_PERIOD_DAYS: 14,
  
  // Company trial period configuration
  COMPANY_TRIAL_DAYS: parseInt(process.env.COMPANY_TRIAL_DAYS || '30'),
  
  // Webhook events we handle
  WEBHOOK_EVENTS: [
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'checkout.session.completed',
    'setup_intent.succeeded',
  ],
} as const