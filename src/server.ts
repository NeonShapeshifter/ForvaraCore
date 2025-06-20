// Forvara Core Server - Express.js + TypeScript
// Sistema multitenant para gestión de usuarios, empresas y suscripciones

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { z } from 'zod';

// =============================================================================
// CONFIGURACIÓN Y TIPOS
// =============================================================================

interface Config {
  PORT: number;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  JWT_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NODE_ENV: 'development' | 'production' | 'test';
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    tenant_id?: string;
  };
  subscription?: SubscriptionStatus;
}

interface SubscriptionStatus {
  active: boolean;
  plan: 'free' | 'trial' | 'pro' | 'enterprise';
  status: 'active' | 'expired' | 'cancelled' | 'suspended';
  expires_at: string | null;
  features: {
    max_users: number;
    max_storage_gb: number;
    enabled_modules: string[];
    rate_limits: Record<string, any>;
  };
}

interface CreateTenantRequest {
  nombre: string;
  ruc: string;
  direccion?: string;
  telefono?: string;
  email?: string;
}

interface CreateUserRequest {
  nombre: string;
  apellido: string;
  telefono: string;
  email?: string;
}

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

const config: Config = {
  PORT: parseInt(process.env.PORT || '3000'),
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NODE_ENV: (process.env.NODE_ENV as any) || 'development'
};

// Validar configuración requerida
if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

// =============================================================================
// INICIALIZACIÓN
// =============================================================================

const app = express();
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY);

let stripe: Stripe | undefined;
if (config.STRIPE_SECRET_KEY) {
  stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: '2025-05-28.basil'
  });
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Middleware básico
app.use(helmet());
app.use(cors({
  origin: config.NODE_ENV === 'production' 
    ? ['https://forvara.com', 'https://elaris.app']
    : true,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // límite de 100 requests por IP
  message: 'Too many requests from this IP'
});
app.use('/api/', limiter);

// Logging
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing
app.use('/webhook', express.raw({ type: 'application/json' })); // Para Stripe webhooks
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// MIDDLEWARE DE AUTENTICACIÓN
// =============================================================================

async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verificar token con Supabase
    const { data, error } = await supabase.auth.getUser(token);
    
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// =============================================================================
// MIDDLEWARE DE SUSCRIPCIÓN
// =============================================================================

function requireActiveSubscription(app_id: string = 'elaris') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.headers['x-tenant-id'] as string;
      
      if (!tenantId) {
        return res.status(400).json({ error: 'X-Tenant-ID header required' });
      }

      // Verificar que el usuario pertenece al tenant
      const { data: userTenant, error: userTenantError } = await supabase
        .from('user_tenants')
        .select('*')
        .eq('usuario_id', req.user!.id)
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .single();

      if (userTenantError || !userTenant) {
        return res.status(403).json({ error: 'Access denied to this tenant' });
      }

      // Verificar suscripción
      const { data: subscription, error: subError } = await supabase
        .rpc('check_subscription_status', {
          p_tenant_id: tenantId,
          p_app_id: app_id
        });

      if (subError) {
        throw subError;
      }

      if (!subscription || !subscription.active) {
        return res.status(402).json({
          error: 'Active subscription required',
          subscription
        });
      }

      req.subscription = subscription;
      req.user!.tenant_id = tenantId;
      next();
    } catch (error) {
      console.error('Subscription middleware error:', error);
      res.status(500).json({ error: 'Subscription verification failed' });
    }
  };
}

// =============================================================================
// VALIDACIÓN CON ZOD
// =============================================================================

const createTenantSchema = z.object({
  nombre: z.string().min(2).max(255),
  ruc: z.string().min(10).max(20),
  direccion: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email().optional()
});

const createUserSchema = z.object({
  nombre: z.string().min(2).max(100),
  apellido: z.string().min(2).max(100),
  telefono: z.string().min(10).max(20),
  email: z.string().email().optional()
});

function validateBody(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors
        });
      }
      next(error);
    }
  };
}

// =============================================================================
// RUTAS PÚBLICAS
// =============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    service: 'Forvara Core',
    status: 'running',
    features: {
      auth: true,
      subscriptions: true,
      payments: !!stripe
    }
  });
});

// =============================================================================
// RUTAS DE AUTENTICACIÓN
// =============================================================================

app.post('/api/auth/register', validateBody(createUserSchema), async (req: Request, res: Response) => {
  try {
    const userData: CreateUserRequest = req.body;

    // Crear usuario en Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      phone: userData.telefono,
      email: userData.email,
      user_metadata: {
        nombre: userData.nombre,
        apellido: userData.apellido,
        telefono: userData.telefono
      },
      email_confirm: true,
      phone_confirm: true
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: data.user.id,
        email: data.user.email,
        phone: data.user.phone
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// =============================================================================
// RUTAS DE USUARIOS
// =============================================================================

app.get('/api/users/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabase.rpc('get_usuario_actual');
    
    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

app.put('/api/users/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { nombre, apellido, telefono, email } = req.body;
    
    const { data, error } = await supabase
      .from('users')
      .update({
        nombre,
        apellido,
        telefono,
        email,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user!.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json({ message: 'Profile updated successfully', user: data });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// =============================================================================
// RUTAS DE TENANTS
// =============================================================================

app.post('/api/tenants', authenticateToken, validateBody(createTenantSchema), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantData: CreateTenantRequest = req.body;

    const { data, error } = await supabase
      .from('tenants')
      .insert({
        ...tenantData,
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.status(201).json({
      message: 'Tenant created successfully',
      tenant: data
    });
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ error: 'Failed to create tenant' });
  }
});

app.get('/api/tenants', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select(`
        *,
        user_tenants!inner(
          rol,
          activo
        )
      `)
      .eq('user_tenants.usuario_id', req.user!.id)
      .eq('user_tenants.activo', true);

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Get tenants error:', error);
    res.status(500).json({ error: 'Failed to get tenants' });
  }
});

// =============================================================================
// RUTAS DE SUSCRIPCIONES
// =============================================================================

app.get('/api/subscription/status', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenantId = req.query.tenant_id as string;
    const appId = req.query.app as string || 'elaris';

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id parameter required' });
    }

    // Verificar acceso al tenant
    const { data: userTenant, error: accessError } = await supabase
      .from('user_tenants')
      .select('*')
      .eq('usuario_id', req.user!.id)
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .single();

    if (accessError || !userTenant) {
      return res.status(403).json({ error: 'Access denied to this tenant' });
    }

    const { data: subscription, error } = await supabase
      .rpc('check_subscription_status', {
        p_tenant_id: tenantId,
        p_app_id: appId
      });

    if (error) {
      throw error;
    }

    // Generar token firmado para modo offline
    const offlineToken = jwt.sign(
      {
        tenant_id: tenantId,
        app_id: appId,
        plan: subscription.plan,
        expires_at: subscription.expires_at,
        features: subscription.features
      },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      ...subscription,
      offline_token: offlineToken
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ error: 'Failed to get subscription status' });
  }
});

app.post('/api/subscription/upgrade', authenticateToken, requireActiveSubscription(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { plan } = req.body;
    const tenantId = req.user!.tenant_id!;

    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Actualizar suscripción
    const { data, error } = await supabase
      .from('subscriptions')
      .update({
        plan,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 días
        updated_at: new Date().toISOString()
      })
      .eq('tenant_id', tenantId)
      .eq('app_id', 'elaris')
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Actualizar características
    const features = {
      pro: {
        max_users: 10,
        max_storage_gb: 10,
        enabled_modules: ['inventario', 'ventas', 'compras', 'reportes']
      },
      enterprise: {
        max_users: 100,
        max_storage_gb: 100,
        enabled_modules: ['inventario', 'ventas', 'compras', 'reportes', 'avanzado']
      }
    };

    await supabase
      .from('tenant_features')
      .update(features[plan as keyof typeof features])
      .eq('tenant_id', tenantId)
      .eq('app_id', 'elaris');

    res.json({
      message: 'Subscription upgraded successfully',
      subscription: data
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(500).json({ error: 'Failed to upgrade subscription' });
  }
});

// =============================================================================
// WEBHOOKS DE STRIPE
// =============================================================================

if (stripe && config.STRIPE_WEBHOOK_SECRET) {
  app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
    try {
      const sig = req.headers['stripe-signature'] as string;
      const event = stripe!.webhooks.constructEvent(req.body, sig, config.STRIPE_WEBHOOK_SECRET!);

      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
          break;
        
        case 'customer.subscription.deleted':
          await handleSubscriptionCancellation(event.data.object as Stripe.Subscription);
          break;
        
        case 'invoice.payment_succeeded':
          await handlePaymentSuccess(event.data.object as Stripe.Invoice);
          break;
        
        case 'invoice.payment_failed':
          await handlePaymentFailed(event.data.object as Stripe.Invoice);
          break;
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(400).json({ error: 'Webhook failed' });
    }
  });
}

// =============================================================================
// HANDLERS DE STRIPE
// =============================================================================

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  // Actualizar suscripción en base de datos
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: subscription.status,
      expires_at: new Date(subscription.current_period_end * 1000).toISOString(),
      stripe_subscription_id: subscription.id
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    console.error('Error updating subscription:', error);
  }
}

async function handleSubscriptionCancellation(subscription: Stripe.Subscription) {
  const { error } = await supabase
    .from('subscriptions')
    .update({
      status: 'cancelled',
      auto_renew: false
    })
    .eq('stripe_subscription_id', subscription.id);

  if (error) {
    console.error('Error cancelling subscription:', error);
  }
}

async function handlePaymentSuccess(invoice: Stripe.Invoice) {
  // Log successful payment
  console.log('Payment succeeded for invoice:', invoice.id);
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  // Handle failed payment
  console.log('Payment failed for invoice:', invoice.id);
}

// =============================================================================
// RUTAS DE ADMINISTRACIÓN
// =============================================================================

app.get('/api/admin/stats', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Solo admins pueden ver stats globales
    const { data: adminCheck } = await supabase
      .from('user_tenants')
      .select('rol')
      .eq('usuario_id', req.user!.id)
      .eq('rol', 'admin')
      .limit(1);

    if (!adminCheck || adminCheck.length === 0) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const [
      { count: totalUsers },
      { count: totalTenants },
      { count: activeSubscriptions }
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('tenants').select('*', { count: 'exact', head: true }),
      supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active')
    ]);

    res.json({
      total_users: totalUsers,
      total_tenants: totalTenants,
      active_subscriptions: activeSubscriptions
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get admin stats' });
  }
});

// =============================================================================
// MANEJO DE ERRORES
// =============================================================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', err);
  
  res.status(500).json({
    error: config.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// =============================================================================
// INICIO DEL SERVIDOR
// =============================================================================

const server = app.listen(config.PORT, () => {
  console.log(`🚀 Forvara Core Server running on port ${config.PORT}`);
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  console.log(`🔐 Auth: Supabase ${config.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`💳 Payments: Stripe ${stripe ? '✅' : '❌'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

export default app;
