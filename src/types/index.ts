import { Request } from 'express';

// =====================================================
// CORE USER & COMPANY TYPES
// =====================================================

export interface User {
  id: string;
  
  // Core identity
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  
  // Panama specific
  cedula_panama?: string;
  tax_id_type: 'cedula' | 'passport' | 'ruc';
  
  // Auth
  email_verified: boolean;
  phone_verified: boolean;
  auth_method: 'email' | 'phone' | 'both';
  password_hash?: string;
  
  // Localization
  preferred_language: 'es' | 'en' | 'sv' | 'pt';
  timezone: string;
  currency_code: string;
  country_code: string;
  
  // Profile
  avatar_url?: string;
  settings: Record<string, any>;
  
  // Tracking
  last_login_at?: string;
  last_ip_address?: string;
  
  // Timestamps
  created_at: string;
  updated_at: string;
  
  // Runtime properties (not in database)
  company_id?: string; // Set by tenant middleware
}

export interface Company {
  id: string;
  
  // Core company info
  razon_social: string;
  ruc: string;
  address?: string;
  phone?: string;
  contact_email?: string;
  
  // Localization
  country_code: string;
  currency_code: string;
  timezone: string;
  
  // Business settings
  industry_type?: string;
  company_size?: 'micro' | 'pequena' | 'mediana' | 'grande';
  
  // Forvara specific
  slug: string;
  description?: string;
  logo_url?: string;
  slots_limit: number;
  storage_limit_gb: number;
  storage_used_bytes: number;
  
  // Billing
  billing_email?: string;
  billing_address?: string;
  tax_exempt: boolean;
  
  // Status
  status: 'active' | 'suspended' | 'inactive' | 'trial';
  trial_ends_at?: string;
  
  // Ownership
  owner_id: string;
  created_by?: string;
  
  // Metadata
  settings: Record<string, any>;
  onboarding_completed: boolean;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface CompanyMember {
  id: string;
  user_id: string;
  company_id: string;
  
  // Role and permissions
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: string[];
  
  // Status
  status: 'active' | 'pending' | 'inactive';
  
  // Invitation tracking
  invited_by?: string;
  invitation_token?: string;
  invitation_expires_at?: string;
  
  // Timestamps
  joined_at: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// APPS & MARKETPLACE TYPES
// =====================================================

export interface App {
  id: string;
  
  // App identity
  name: string;
  display_name: string;
  slug: string;
  description?: string;
  short_description?: string;
  
  // Media
  icon_url?: string;
  screenshots: string[];
  demo_url?: string;
  
  // Classification
  category: string;
  industry_tags: string[];
  
  // Technical
  version: string;
  app_url?: string;
  api_endpoint?: string;
  webhook_url?: string;
  
  // Marketplace
  is_active: boolean;
  is_featured: boolean;
  is_free: boolean;
  
  // Pricing
  base_price_monthly: number;
  price_per_user: number;
  min_users: number;
  max_users?: number;
  
  // Features and configuration
  features: Record<string, any>;
  configuration_schema: Record<string, any>;
  supported_countries: string[];
  
  // Metadata
  settings: Record<string, any>;
  install_count: number;
  rating_avg: number;
  
  // Publishing
  published_at?: string;
  published_by?: string;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  company_id: string;
  app_id: string;
  
  // Plan details
  plan_name: string;
  billing_cycle: 'monthly' | 'yearly' | 'one_time';
  price_monthly: number;
  currency_code: string;
  
  // Subscription status
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'paused';
  
  // Features and limits
  features: Record<string, any>;
  user_limit?: number;
  users_assigned: number;
  
  // Billing periods
  trial_ends_at?: string;
  current_period_start: string;
  current_period_end?: string;
  canceled_at?: string;
  cancellation_reason?: string;
  
  // Payment integration
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  
  // Configuration
  app_configuration: Record<string, any>;
  metadata: Record<string, any>;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

// =====================================================
// ENTERPRISE FEATURE TYPES
// =====================================================

export interface AuditLog {
  id: string;
  
  // Context
  company_id?: string;
  user_id?: string;
  app_id?: string;
  
  // Action details
  entity_type: string;
  entity_id: string;
  action: string;
  
  // Change tracking
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  
  // Request context
  ip_address?: string;
  user_agent?: string;
  request_id?: string;
  
  // Risk assessment
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  
  // Metadata
  details: Record<string, any>;
  
  // Timestamp
  created_at: string;
}

export interface UserSession {
  id: string;
  
  // Session identity
  session_id: string;
  user_id: string;
  company_id?: string;
  
  // Device and location
  ip_address?: string;
  user_agent?: string;
  device_type?: string;
  browser?: string;
  os?: string;
  country_code?: string;
  city?: string;
  
  // App usage
  apps_accessed: string[];
  last_app_used?: string;
  pages_visited: number;
  
  // Session tracking
  started_at: string;
  last_activity_at: string;
  ended_at?: string;
  duration_minutes?: number;
  
  // Status
  is_active: boolean;
  end_reason?: string;
  
  // Timestamps
  created_at: string;
}

export interface RevenueTracking {
  id: string;
  
  // Revenue source
  company_id: string;
  subscription_id?: string;
  app_id?: string;
  
  // Revenue details
  amount: number;
  currency_code: string;
  revenue_type: 'subscription' | 'dlc' | 'storage' | 'overage';
  
  // MRR calculation
  mrr_contribution: number;
  arr_contribution: number;
  
  // Billing period
  billing_period_start: string;
  billing_period_end: string;
  
  // Payment tracking
  stripe_invoice_id?: string;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  paid_at?: string;
  
  // Recognition
  recognized_at?: string;
  
  // Metadata
  metadata: Record<string, any>;
  
  // Timestamps
  created_at: string;
}

export interface OnboardingFlow {
  id: string;
  
  // Target
  company_id: string;
  user_id: string;
  
  // Flow definition
  flow_type: 'company_setup' | 'app_installation' | 'feature_adoption';
  industry_type?: string;
  
  // Progress tracking
  total_steps: number;
  completed_steps: number;
  current_step?: string;
  stuck_at_step?: string;
  completion_percentage: number;
  
  // Recommendations
  recommended_apps: string[];
  next_recommended_action?: string;
  
  // Analytics
  started_at: string;
  last_activity_at: string;
  completed_at?: string;
  abandoned_at?: string;
  
  // Metadata
  flow_data: Record<string, any>;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

// =====================================================
// SUPPORTING TYPES
// =====================================================

export interface File {
  id: string;
  company_id: string;
  uploaded_by?: string;
  app_id?: string;
  
  // File info
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  
  // Access control
  is_public: boolean;
  access_level: 'public' | 'company' | 'app' | 'user';
  
  // Organization
  folder_path: string;
  tags: string[];
  
  // Metadata
  metadata: Record<string, any>;
  
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  company_id?: string;
  
  // Notification content
  type: 'info' | 'warning' | 'error' | 'success';
  category: string;
  title: string;
  message?: string;
  
  // Delivery
  channels: ('in_app' | 'email' | 'sms')[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  
  // Status
  is_read: boolean;
  read_at?: string;
  
  // Metadata
  data: Record<string, any>;
  action_url?: string;
  
  // Timestamps
  created_at: string;
}

export interface Country {
  code: string;
  name: string;
  currency_code: string;
  timezone: string;
  tax_rate: number;
  tax_name: string;
  date_format: string;
  number_format: string;
  phone_prefix?: string;
  supported_languages: string[];
  is_active: boolean;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  is_active: boolean;
}

export interface Translation {
  id: string;
  key: string;
  language_code: string;
  value: string;
  context?: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// REQUEST & RESPONSE TYPES
// =====================================================

export interface AuthRequest extends Request {
  user?: User;
  company?: Company;
  session?: UserSession;
  tenant_id?: string;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: Record<string, any>;
  };
  total?: number;
  page?: number;
  limit?: number;
  meta?: Record<string, any>;
}

export interface JWTPayload {
  userId: string;
  email?: string;
  phone?: string;
  companyId?: string;
  role?: string;
  iat: number;
  exp: number;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  status?: string;
  company_id?: string;
  user_id?: string;
  app_id?: string;
  date_from?: string;
  date_to?: string;
}

// =====================================================
// AUTH & REGISTRATION TYPES
// =====================================================

export interface RegisterUserRequest {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  password: string;
  cedula_panama?: string;
  preferred_language?: 'es' | 'en' | 'sv' | 'pt';
  country_code?: string;
  timezone?: string;
}

export interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
}

export interface CreateCompanyRequest {
  razon_social: string;
  ruc: string;
  address?: string;
  phone?: string;
  contact_email?: string;
  industry_type?: string;
  company_size?: 'micro' | 'pequena' | 'mediana' | 'grande';
  billing_email?: string;
  billing_address?: string;
}

export interface InviteMemberRequest {
  email?: string;
  phone?: string;
  role: 'admin' | 'member' | 'viewer';
  permissions?: string[];
}

// =====================================================
// BILLING & SUBSCRIPTION TYPES
// =====================================================

export interface SubscriptionPlan {
  id: string;
  app_id: string;
  name: string;
  price_monthly: number;
  price_yearly: number;
  currency_code: string;
  features: Record<string, any>;
  user_limit?: number;
  is_popular: boolean;
  is_active: boolean;
}

export interface BillingInfo {
  company_id: string;
  stripe_customer_id?: string;
  billing_email: string;
  total_monthly_cost: number;
  subscriptions: Subscription[];
  payment_methods: any[]; // Stripe.PaymentMethod[]
  trial_ends_at?: string;
  billing_address?: string;
  tax_exempt?: boolean;
}

// =====================================================
// STRIPE INTEGRATION TYPES
// =====================================================

export interface CreateCustomerRequest {
  email?: string;
  name?: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  };
}

export interface CreateSubscriptionRequest {
  company_id: string;
  app_id: string;
  plan_name: string;
  price_id: string;
  billing_cycle: 'monthly' | 'yearly' | 'one_time';
  price_monthly: number;
  customer_email: string;
  customer_name: string;
  trial_days?: number;
}

// =====================================================
// RATE LIMITING TYPES
// =====================================================

export interface RateLimitConfig {
  company_id: string;
  app_id?: string;
  user_id?: string;
  endpoint_pattern?: string;
  requests_per_minute: number;
  requests_per_hour: number;
  requests_per_day: number;
  daily_quota: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  reset_time: number;
  retry_after?: number;
}

// =====================================================
// ANALYTICS & REPORTING TYPES
// =====================================================

export interface AnalyticsMetrics {
  total_users: number;
  active_users: number;
  total_companies: number;
  active_subscriptions: number;
  mrr: number;
  arr: number;
  churn_rate: number;
  growth_rate: number;
}

export interface UsageMetrics {
  company_id: string;
  app_id?: string;
  active_users: number;
  total_sessions: number;
  avg_session_duration: number;
  api_calls: number;
  storage_used: number;
  period_start: string;
  period_end: string;
}

// =====================================================
// ERROR TYPES
// =====================================================

export interface ErrorResponse {
  error: {
    message: string;
    code: string;
    details?: Record<string, any>;
    timestamp: string;
    request_id?: string;
  };
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
  value?: any;
}

// =====================================================
// WEBHOOK TYPES
// =====================================================

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, any>;
  company_id?: string;
  app_id?: string;
  created_at: string;
}

export interface WebhookEndpoint {
  id: string;
  company_id: string;
  app_id?: string;
  url: string;
  events: string[];
  secret: string;
  is_active: boolean;
  created_at: string;
}

// All types are exported individually above