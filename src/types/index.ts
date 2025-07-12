import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  tenantId?: string;
  userRole?: string;
  user?: ForvaraUser;
  tenant?: Tenant;
  startTime?: number;
  requestId?: string;
  rawBody?: string;
  file?: any;
  files?: any[];
}

export interface ForvaraUser {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email?: string;
  forvara_mail?: string;
  avatar_url?: string;
  settings?: UserSettings;
  activo: boolean;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'auto';
  language: 'es' | 'en';
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    marketing: boolean;
  };
}

export interface Tenant {
  id: string;
  nombre: string;
  ruc: string;
  direccion?: string;
  telefono?: string;
  email?: string;
  logo_url?: string;
  configuracion?: TenantConfig;
  activo: boolean;
  storage_used_gb: number;
  deleted_at?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TenantConfig {
  sector?: 'retail' | 'services' | 'manufacturing' | 'restaurant' | 'logistics' | 'other';
  size?: 'small' | 'medium' | 'large' | 'enterprise';
  onboarding_completed?: boolean;
  features_enabled?: string[];
  custom_settings?: Record<string, any>;
}

export interface UserTenant {
  id: string;
  usuario_id: string;
  tenant_id: string;
  rol: UserRole;
  activo: boolean;
  permisos?: string[];
  joined_at: string;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type UserRole = 'super_admin' | 'admin' | 'manager' | 'miembro' | 'viewer' | 'guest';

export interface Subscription {
  id: string;
  tenant_id: string;
  app_id: string;
  plan_id?: string;
  plan: string;
  status: SubscriptionStatus;
  billing_cycle: 'monthly' | 'yearly';
  features: SubscriptionFeatures;
  current_period_start: string;
  current_period_end?: string;
  trial_ends_at?: string;
  canceled_at?: string;
  cancel_reason?: string;
  ends_at?: string;
  price_monthly: number;
  stripe_subscription_id?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export type SubscriptionStatus = 
  | 'active' 
  | 'trialing' 
  | 'past_due' 
  | 'canceled' 
  | 'canceled_pending' 
  | 'incomplete' 
  | 'incomplete_expired' 
  | 'unpaid';

export interface SubscriptionFeatures {
  max_users?: number;
  max_storage_gb?: number;
  max_invoices?: number;
  max_products?: number;
  enabled_modules?: string[];
  api_access?: boolean;
  advanced_reports?: boolean;
  [key: string]: any;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  meta?: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
    performance?: {
      duration_ms: number;
      queries?: number;
    };
    [key: string]: any;
  };
}

export interface PaginationParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, any>;
}

export interface JwtPayload {
  userId: string;
  tenantId?: string;
  sessionId?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface SessionData {
  id: string;
  user_id: string;
  token_hash: string;
  device_info: DeviceInfo;
  ip_address: string;
  last_ip?: string;
  last_activity: string;
  expires_at: string;
  created_at: string;
}

export interface DeviceInfo {
  user_agent: string;
  ip: string;
  platform: string;
  browser: string;
  version?: string;
}

export interface ActivityLog {
  id: string;
  tenant_id?: string;
  user_id?: string;
  app_id?: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  success: boolean;
  error_message?: string;
  request_id?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message?: string;
  data?: Record<string, any>;
  is_read: boolean;
  read_at?: string;
  created_at: string;
}

export type NotificationType = 
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'team_invite'
  | 'team_update'
  | 'team_removal'
  | 'subscription_update'
  | 'payment_success'
  | 'payment_failed'
  | 'file_shared'
  | 'mention'
  | 'admin_notification';

export interface FileUpload {
  id: string;
  tenant_id: string;
  uploaded_by: string;
  app_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  metadata?: Record<string, any>;
  is_public: boolean;
  tags: string[];
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MailChannel {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  type: 'general' | 'project' | 'department' | 'announcement';
  is_private: boolean;
  created_by: string;
  deleted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface MailMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  attachments?: any[];
  mentions?: string[];
  is_edited: boolean;
  edited_at?: string;
  deleted_at?: string;
  created_at: string;
}

export interface AppInfo {
  id: string;
  name: string;
  display_name: string;
  description?: string;
  icon_url?: string;
  category?: string;
  is_free: boolean;
  active: boolean;
  visible_in_marketplace: boolean;
  display_order: number;
  created_at: string;
}

export interface SubscriptionPlan {
  id: string;
  app_id: string;
  name: string;
  display_name: string;
  description?: string;
  price_monthly: number;
  price_yearly?: number;
  currency: string;
  features: Record<string, any>;
  active: boolean;
  display_order: number;
  has_trial: boolean;
  trial_days?: number;
  created_at: string;
  updated_at: string;
}

export interface Addon {
  id: string;
  app_id: string;
  name: string;
  display_name: string;
  description?: string;
  price_monthly: number;
  unit_label?: string;
  features: Record<string, any>;
  active: boolean;
  created_at: string;
}

export interface TenantUsage {
  storage_gb: number;
  users: number;
  api_calls_last_hour: number;
  file_uploads_today: number;
  mail_messages_today?: number;
  apps: Record<string, any>;
}

export interface TenantLimits {
  storage_gb: number;
  users: number;
  api_calls_per_hour: number;
  file_uploads_per_day: number;
  mail_channels?: number;
  mail_messages_per_day?: number;
  apps: Record<string, any>;
}

export interface UsageAnalysis {
  status: 'healthy' | 'warning' | 'critical';
  percentages: Record<string, number>;
  alerts: UsageAlert[];
  recommendations: UsageRecommendation[];
}

export interface UsageAlert {
  type: 'info' | 'warning' | 'critical';
  resource: string;
  percentage: number;
  message: string;
  action?: string;
}

export interface UsageRecommendation {
  type: string;
  priority: 'low' | 'medium' | 'high';
  message: string;
  action: string;
  estimated_cost?: number;
}

// WebSocket types
export interface SocketUser {
  userId: string;
  tenantId?: string;
  socketId: string;
  connectedAt: Date;
}

export interface SocketMessage {
  event: string;
  data: any;
  room?: string;
  to?: string | string[];
}

// Queue job types
export interface EmailJob {
  to: string | string[];
  subject: string;
  template: string;
  data: Record<string, any>;
  attachments?: any[];
}

export interface FileProcessingJob {
  fileId: string;
  operations: ('thumbnail' | 'virus-scan' | 'extract-metadata' | 'compress')[];
  priority?: number;
}

export interface NotificationJob {
  userId: string | string[];
  notification: Omit<Notification, 'id' | 'user_id' | 'created_at'>;
  channels?: ('in-app' | 'email' | 'push' | 'sms')[];
}

// Error types
export interface ApiError extends Error {
  code?: string;
  statusCode?: number;
  details?: any;
}

export class ValidationError extends Error implements ApiError {
  code = 'VALIDATION_ERROR';
  statusCode = 400;
  details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AuthenticationError extends Error implements ApiError {
  code = 'UNAUTHORIZED';
  statusCode = 401;

  constructor(message: string = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error implements ApiError {
  code = 'FORBIDDEN';
  statusCode = 403;

  constructor(message: string = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends Error implements ApiError {
  code = 'NOT_FOUND';
  statusCode = 404;

  constructor(resource: string) {
    super(`${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error implements ApiError {
  code = 'CONFLICT';
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends Error implements ApiError {
  code = 'RATE_LIMIT_EXCEEDED';
  statusCode = 429;

  constructor(message: string = 'Rate limit exceeded') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class ServerError extends Error implements ApiError {
  code = 'INTERNAL_ERROR';
  statusCode = 500;

  constructor(message: string = 'Internal server error') {
    super(message);
    this.name = 'ServerError';
  }
}

export class PaymentError extends Error implements ApiError {
  code = 'PAYMENT_ERROR';
  statusCode = 402;

  constructor(message: string = 'Payment processing failed') {
    super(message);
    this.name = 'PaymentError';
  }
}

// Additional types for billing and apps
export interface ErrorCode {
  [key: string]: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface App {
  id: string;
  name: string;
  display_name: string;
  description: string;
  icon_url?: string;
  app_url: string;
  version: string;
  category_id: string;
  status: 'active' | 'inactive' | 'development';
  featured: boolean;
  is_public: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AppInstallation {
  id: string;
  tenant_id: string;
  app_id: string;
  installed_by: string;
  status: 'installing' | 'installed' | 'uninstalled';
  config: Record<string, any>;
  installed_at: string;
  uninstalled_at?: string;
  last_accessed?: string;
  access_count: number;
}

export interface AppPermission {
  id: string;
  app_id: string;
  permission_key: string;
  name: string;
  description: string;
  required: boolean;
}

export interface SubscriptionPlanExtended {
  id: string;
  app_id: string;
  name: string;
  display_name: string;
  description?: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: Record<string, any>;
  has_trial: boolean;
  trial_days: number;
  stripe_price_id?: string;
  stripe_product_id?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  amount_due: number;
  amount_paid: number;
  currency: string;
  status: string;
  description?: string;
  pdf_url?: string;
  hosted_invoice_url?: string;
  due_date?: string;
  paid_at?: string;
  created_at: string;
}

export interface PaymentMethod {
  id: string;
  tenant_id: string;
  stripe_payment_method_id: string;
  type: string;
  last_four?: string;
  brand?: string;
  exp_month?: number;
  exp_year?: number;
  is_default: boolean;
  active: boolean;
  created_at: string;
}

export interface BillingInfo {
  legal_name: string;
  email: string;
  phone?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  tax_id?: string;
  tax_id_type?: string;
}

export interface User {
  id: string;
  email: string;
  phone?: string;
  profile?: {
    full_name: string;
    avatar_url?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface SubscriptionFeature {
  id: string;
  subscription_id: string;
  feature_key: string;
  value: string;
  current_usage: number;
  is_active: boolean;
}
