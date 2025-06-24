import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import { z } from 'zod';
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

// =============================================================================
// CONFIGURACIÓN Y TIPOS 
// =============================================================================

interface Config {
  PORT: number;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_ANON_KEY: string;
  JWT_SECRET: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  NODE_ENV: 'development' | 'production' | 'test';
  FRONTEND_URLS: string[];
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    tenant_id?: string;
    rol?: string;
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
  user_role?: string;
  tenant_info?: {
    id: string;
    role: string;
  };
  offline_token?: string;
}

interface ForvaraUser {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email?: string;
  avatar_url?: string;
  tenants: Array<{
    id: string;
    nombre: string;
    ruc: string;
    rol: string;
    activo: boolean;
  }>;
}

// =============================================================================
// VALIDACIÓN CON ZOD
// =============================================================================

const loginSchema = z.object({
  email: z.string().email('Email inválido').optional(),
  telefono: z.string().min(8, 'Teléfono inválido').optional(),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres')
}).refine(data => data.email || data.telefono, {
  message: 'Debe proporcionar email o teléfono'
});

const registerSchema = z.object({
  nombre: z.string().min(2, 'Nombre debe tener al menos 2 caracteres').max(100),
  apellido: z.string().min(2, 'Apellido debe tener al menos 2 caracteres').max(100),
  telefono: z.string().min(8, 'Teléfono inválido').max(20),
  email: z.string().email('Email inválido').optional(),
  password: z.string().min(6, 'Contraseña debe tener al menos 6 caracteres')
});

const createTenantSchema = z.object({
  nombre: z.string().min(2, 'Nombre de empresa requerido').max(255),
  ruc: z.string().min(10, 'RUC inválido').max(20),
  direccion: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email('Email inválido').optional()
});

// =============================================================================
// CONFIGURACIÓN
// =============================================================================

const config: Config = {
  PORT: parseInt(process.env.PORT || '3000'),
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || 'your-secret-key',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NODE_ENV: (process.env.NODE_ENV as any) || 'development',
  FRONTEND_URLS: process.env.FRONTEND_URLS?.split(',') || [
    'http://localhost:3000',
    'https://elaris.app',
    'https://cuenta.forvara.com'
  ]
};

// Validar configuración crítica
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Variable de entorno requerida: ${envVar}`);
  }
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
// MIDDLEWARE BÁSICO
// =============================================================================

app.use(helmet({ crossOriginEmbedderPolicy: false }));

app.use(cors({
  origin: config.NODE_ENV === 'production' ? config.FRONTEND_URLS : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-App-ID']
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones. Intenta más tarde.' }
});

//app.use('/api/auth', authLimiter);
//app.use('/api/', generalLimiter);
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// =============================================================================
// MIDDLEWARE DE AUTENTICACIÓN CORREGIDO
// =============================================================================

const authenticateToken: RequestHandler = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ 
        error: 'Access token required',
        code: 'MISSING_TOKEN'
      });
      return;
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, config.JWT_SECRET);
    } catch (jwtError) {
      const { data, error } = await supabase.auth.getUser(token);
      
      if (error || !data.user) {
        res.status(401).json({ 
          error: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
        return;
      }

      req.user = {
        id: data.user.id,
        email: data.user.email
      };
      next();
      return;
    }

    req.user = {
      id: decoded.user_id,
      email: decoded.email,
      tenant_id: decoded.tenant_id,
      rol: decoded.rol
    };

    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// =============================================================================
// MIDDLEWARE DE VALIDACIÓN CORREGIDO
// =============================================================================

function validateBody(schema: z.ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: result.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
        return;
      }
      req.body = result.data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// =============================================================================
// UTILIDADES
// =============================================================================

function generateJWT(user: any, tenant?: any): string {
  const payload = {
    user_id: user.id,
    email: user.email,
    tenant_id: tenant?.id,
    rol: tenant?.rol,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
  };

  return jwt.sign(payload, config.JWT_SECRET);
}

async function logActivity(params: {
  tenant_id?: string;
  usuario_id?: string;
  app_id?: string;
  action: string;
  details?: Record<string, any>;
  req: Request;
}): Promise<void> {
  try {
    await supabase.from('activity_logs').insert({
      tenant_id: params.tenant_id,
      usuario_id: params.usuario_id,
      app_id: params.app_id,
      action: params.action,
      details: params.details || {},
      ip_address: params.req.ip,
      user_agent: params.req.get('User-Agent')
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// =============================================================================
// RUTAS PÚBLICAS
// =============================================================================

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.1.0',
    services: {
      database: 'connected',
      auth: 'supabase',
      payments: stripe ? 'stripe' : 'disabled'
    }
  });
});

app.get('/api/status', (req: Request, res: Response) => {
  res.json({
    service: 'Forvara Core',
    status: 'running',
    features: {
      auth: true,
      subscriptions: true,
      payments: !!stripe,
      realtime: true
    }
  });
});

// =============================================================================
// HANDLERS DE AUTENTICACIÓN CORREGIDOS
// =============================================================================

const loginHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, telefono, password } = req.body;

    // Intentar login con Supabase
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email || `${telefono}@temp.forvara.com`,
      password
    });

    if (error) {
      await logActivity({
        action: 'LOGIN_FAILED',
        details: { email, telefono, error: error.message },
        req
      });
      
      res.status(401).json({ 
        error: 'Credenciales inválidas',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Obtener datos del usuario de public.users (SIN INNER JOIN)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (userError || !userData) {
      res.status(404).json({ 
        error: 'Usuario no encontrado',
        code: 'USER_NOT_FOUND'
      });
      return;
    }

    // Obtener tenants del usuario (separado)
    const { data: userTenants, error: tenantsError } = await supabase
      .from('user_tenants')
      .select(`
        tenant_id,
        rol,
        activo,
        tenants(
          id,
          nombre,
          ruc
        )
      `)
      .eq('usuario_id', data.user.id)
      .eq('activo', true);

    // Log successful login
    await logActivity({
      usuario_id: userData.id,
      action: 'LOGIN_SUCCESS',
      details: { email, telefono },
      req
    });

    res.json({
      message: 'Login exitoso',
      user: {
        id: userData.id,
        nombre: userData.nombre,
        apellido: userData.apellido,
        email: userData.email,
        telefono: userData.telefono
      },
      tenants: userTenants?.map((ut: any) => ({
        id: ut.tenants?.id,
        nombre: ut.tenants?.nombre,
        ruc: ut.tenants?.ruc,
        rol: ut.rol
      })) || [],
      token: data.session?.access_token,
      session: data.session
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

const registerHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nombre, apellido, telefono, email, password } = req.body;

    // Crear usuario en Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email: email || `${telefono}@temp.forvara.com`,
      phone: telefono,
      password,
      user_metadata: { nombre, apellido, telefono },
      email_confirm: true,
      phone_confirm: true
    });

    if (error || !data.user) {
      await logActivity({
        action: 'REGISTER_FAILED',
        details: { email, telefono, error: error?.message },
        req
      });

      res.status(400).json({ 
        error: error?.message || 'Error creando usuario',
        code: 'REGISTRATION_FAILED'
      });
      return;
    }

    // Insertar usuario en tabla public.users
    const { error: insertError } = await supabase.from('users').insert({
      id: data.user.id,
      nombre,
      apellido,
      telefono,
      email: data.user.email
    });

    if (insertError) {
      console.error('Error insertando en public.users:', insertError);
      res.status(500).json({
        error: 'Usuario creado en auth pero falló al insertar en tabla users',
        code: 'PARTIAL_REGISTRATION'
      });
      return;
    }

    await logActivity({
      usuario_id: data.user.id,
      action: 'REGISTER_SUCCESS',
      details: { email, telefono },
      req
    });

    res.status(201).json({
      message: 'Usuario creado exitosamente',
      user: {
        id: data.user.id,
        email: data.user.email,
        phone: data.user.phone
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};


const selectTenantHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { tenant_id } = req.body;

    if (!tenant_id) {
      res.status(400).json({ 
        error: 'tenant_id requerido',
        code: 'MISSING_TENANT_ID'
      });
      return;
    }

    const { data: userTenant, error } = await supabase
      .from('user_tenants')
      .select(`*, tenants(*)`)
      .eq('usuario_id', req.user!.id)
      .eq('tenant_id', tenant_id)
      .eq('activo', true)
      .single();

    if (error || !userTenant) {
      res.status(403).json({ 
        error: 'Acceso denegado a esta empresa',
        code: 'ACCESS_DENIED'
      });
      return;
    }

    const token = generateJWT(req.user, {
      id: userTenant.tenant_id,
      rol: userTenant.rol
    });

    await logActivity({
      tenant_id,
      usuario_id: req.user!.id,
      action: 'TENANT_SELECTED',
      details: { tenant_name: userTenant.tenants.nombre },
      req
    });

    res.json({
      message: 'Empresa seleccionada',
      token,
      tenant: {
        id: userTenant.tenants.id,
        nombre: userTenant.tenants.nombre,
        ruc: userTenant.tenants.ruc,
        rol: userTenant.rol
      }
    });

  } catch (error) {
    console.error('Select tenant error:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      code: 'INTERNAL_ERROR'
    });
  }
};

const logoutHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (req.user?.id) {
      await supabase.auth.admin.signOut(req.user.id);
      
      await logActivity({
        usuario_id: req.user.id,
        tenant_id: req.user.tenant_id,
        action: 'LOGOUT',
        req
      });
    }

    res.json({ message: 'Logout exitoso' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      error: 'Error en logout',
      code: 'LOGOUT_ERROR'
    });
  }
};

// =============================================================================
// HANDLERS DE USUARIOS 
// =============================================================================

const getUserProfileHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.rpc('get_usuario_actual');
    
    if (error) {
      throw error;
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ 
      error: 'Error al obtener información del usuario',
      code: 'GET_USER_ERROR'
    });
  }
};

const updateUserProfileHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    await logActivity({
      usuario_id: req.user!.id,
      tenant_id: req.user!.tenant_id,
      action: 'PROFILE_UPDATED',
      details: { updated_fields: Object.keys(req.body) },
      req
    });

    res.json({ 
      message: 'Perfil actualizado exitosamente', 
      user: data 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      error: 'Error al actualizar perfil',
      code: 'UPDATE_PROFILE_ERROR'
    });
  }
};

const getUserTenantsHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('user_tenants')
      .select(`
        rol,
        activo,
        created_at,
        tenants (
          id,
          nombre,
          ruc,
          direccion,
          telefono,
          email,
          logo_url
        )
      `)
      .eq('usuario_id', req.user!.id)
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      tenants: data
    });
  } catch (error) {
    console.error('Get user tenants error:', error);
    res.status(500).json({ 
      error: 'Error al obtener empresas',
      code: 'GET_TENANTS_ERROR'
    });
  }
};

// =============================================================================
// HANDLERS DE TENANTS CORREGIDOS
// =============================================================================

const createTenantHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantData = req.body;

    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('ruc', tenantData.ruc)
      .single();

    if (existingTenant) {
      res.status(409).json({ 
        error: 'Ya existe una empresa con este RUC',
        code: 'RUC_EXISTS'
      });
      return;
    }

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

    await logActivity({
      tenant_id: data.id,
      usuario_id: req.user!.id,
      action: 'TENANT_CREATED',
      details: { tenant_name: data.nombre, ruc: data.ruc },
      req
    });

    res.status(201).json({
      message: 'Empresa creada exitosamente',
      tenant: data
    });
  } catch (error) {
    console.error('Create tenant error:', error);
    res.status(500).json({ 
      error: 'Error al crear empresa',
      code: 'CREATE_TENANT_ERROR'
    });
  }
};

// =============================================================================
// HANDLERS DE SUSCRIPCIONES 
// =============================================================================

const getSubscriptionStatusHandler: RequestHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const tenantId = req.query.tenant_id as string || req.user!.tenant_id;
    const appId = req.query.app as string || 'elaris';

    if (!tenantId) {
      res.status(400).json({ 
        error: 'tenant_id parameter required',
        code: 'MISSING_TENANT_ID'
      });
      return;
    }

    const { data: userTenant, error: accessError } = await supabase
      .from('user_tenants')
      .select('*')
      .eq('usuario_id', req.user!.id)
      .eq('tenant_id', tenantId)
      .eq('activo', true)
      .single();

    if (accessError || !userTenant) {
      res.status(403).json({ 
        error: 'Access denied to this tenant',
        code: 'ACCESS_DENIED'
      });
      return;
    }

    const { data: subscription, error } = await supabase
      .rpc('check_subscription_status', {
        p_tenant_id: tenantId,
        p_app_id: appId
      });

    if (error) {
      throw error;
    }

    const offlineToken = jwt.sign(
      {
        tenant_id: tenantId,
        app_id: appId,
        plan: subscription.plan,
        expires_at: subscription.expires_at,
        features: subscription.features,
        issued_at: Date.now()
      },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.set({
      'Cache-Control': 'private, max-age=300',
      'X-Subscription-Status': subscription.active ? 'active' : 'inactive',
      'X-Plan': subscription.plan
    });

    res.json({
      ...subscription,
      offline_token: offlineToken,
      user_role: userTenant.rol,
      tenant_info: {
        id: tenantId,
        role: userTenant.rol
      }
    });
  } catch (error) {
    console.error('Subscription status error:', error);
    res.status(500).json({ 
      error: 'Failed to get subscription status',
      code: 'SUBSCRIPTION_STATUS_ERROR'
    });
  }
};

const verifyOfflineTokenHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ 
        error: 'Token required',
        code: 'MISSING_TOKEN'
      });
      return;
    }

    const decoded = jwt.verify(token, config.JWT_SECRET) as any;
    
    const now = Date.now();
    const tokenAge = now - decoded.issued_at;
    const maxAge = 30 * 24 * 60 * 60 * 1000;

    if (tokenAge > maxAge) {
      res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
      return;
    }

    let isActive = true;
    if (decoded.expires_at) {
      isActive = new Date(decoded.expires_at) > new Date();
    }

    res.json({
      valid: true,
      active: isActive,
      plan: decoded.plan,
      features: decoded.features,
      tenant_id: decoded.tenant_id,
      app_id: decoded.app_id,
      expires_at: decoded.expires_at
    });

  } catch (error) {
    res.status(401).json({ 
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
};

// =============================================================================
// CONFIGURACIÓN DE RUTAS
// =============================================================================

// Rutas de autenticación
app.post('/api/auth/login', validateBody(loginSchema), loginHandler);
app.post('/api/auth/register', validateBody(registerSchema), registerHandler);
app.post('/api/auth/select-tenant', authenticateToken, selectTenantHandler);
app.post('/api/auth/logout', authenticateToken, logoutHandler);

// Rutas de usuarios
app.get('/api/users/me', authenticateToken, getUserProfileHandler);
app.put('/api/users/me', authenticateToken, updateUserProfileHandler);
app.get('/api/users/tenants', authenticateToken, getUserTenantsHandler);

// Rutas de tenants
app.post('/api/tenants', authenticateToken, validateBody(createTenantSchema), createTenantHandler);

// Rutas de suscripciones
app.get('/api/subscription/status', authenticateToken, getSubscriptionStatusHandler);
app.post('/api/subscription/verify-offline', verifyOfflineTokenHandler);

// =============================================================================
// MANEJO DE ERRORES MEJORADO
// =============================================================================

app.use('*', (req: Request, res: Response) => {
  res.status(404).json({ 
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl
  });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    body: req.body,
    timestamp: new Date().toISOString()
  });
  
  res.status(500).json({
    error: config.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// INICIO DEL SERVIDOR
// =============================================================================

const server = app.listen(config.PORT, () => {
  console.log(`🚀 Forvara Core Server running on port ${config.PORT}`);
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  console.log(`🔐 Auth: Supabase ${config.SUPABASE_URL ? '✅' : '❌'}`);
  console.log(`💳 Payments: Stripe ${stripe ? '✅' : '❌'}`);
  console.log(`🌐 CORS: ${config.FRONTEND_URLS.join(', ')}`);
  console.log(`⚡ Server ready for connections`);
});

const gracefulShutdown = () => {
  console.log('🔄 Received shutdown signal, shutting down gracefully...');
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;
