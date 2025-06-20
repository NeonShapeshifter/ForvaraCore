// @forvara/sdk - TypeScript SDK para verificación de suscripciones
// v1.0.0

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TIPOS
// =============================================================================

export interface ForvaraConfig {
  apiUrl: string;
  apiKey?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}

export interface SubscriptionStatus {
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
  error?: string;
}

export interface VerifySubscriptionParams {
  tenantId: string;
  token?: string;
  app: string;
  userId?: string;
}

export interface CacheEntry {
  data: SubscriptionStatus;
  timestamp: number;
  expires_at: number;
}

export interface OfflineStatus {
  plan: string;
  expires_at: string;
  signature: string;
  cached_at: string;
}

// =============================================================================
// CLIENTE FORVARA
// =============================================================================

export class ForvaraClient {
  private config: ForvaraConfig;
  private supabase?: SupabaseClient;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutos

  constructor(config: ForvaraConfig) {
    this.config = config;
    
    if (config.supabaseUrl && config.supabaseKey) {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    }
  }

  /**
   * Verifica el estado de suscripción de un tenant
   */
  async verifySubscription(params: VerifySubscriptionParams): Promise<SubscriptionStatus> {
    const cacheKey = `${params.tenantId}-${params.app}`;
    
    // Verificar caché primero
    const cached = this.getCachedStatus(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Intentar verificación online
      const status = await this.fetchSubscriptionStatus(params);
      
      // Guardar en caché
      this.setCachedStatus(cacheKey, status);
      
      return status;
    } catch (error) {
      // Si falla, intentar modo offline
      const offlineStatus = this.getOfflineStatus(params.tenantId, params.app);
      if (offlineStatus) {
        return offlineStatus;
      }
      
      throw error;
    }
  }

  /**
   * Obtiene el estado de suscripción desde la API
   */
  private async fetchSubscriptionStatus(params: VerifySubscriptionParams): Promise<SubscriptionStatus> {
    if (this.supabase) {
      // Usar Supabase directamente si está configurado
      return this.fetchFromSupabase(params);
    } else {
      // Usar API REST
      return this.fetchFromAPI(params);
    }
  }

  /**
   * Verificación vía Supabase
   */
  private async fetchFromSupabase(params: VerifySubscriptionParams): Promise<SubscriptionStatus> {
    if (!this.supabase) {
      throw new Error('Supabase not configured');
    }

    const { data, error } = await this.supabase.rpc('check_subscription_status', {
      p_tenant_id: params.tenantId,
      p_app_id: params.app
    });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    return data as SubscriptionStatus;
  }

  /**
   * Verificación vía API REST
   */
  private async fetchFromAPI(params: VerifySubscriptionParams): Promise<SubscriptionStatus> {
    const url = new URL('/subscription/status', this.config.apiUrl);
    url.searchParams.set('app', params.app);
    url.searchParams.set('tenant_id', params.tenantId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (params.token) {
      headers['Authorization'] = `Bearer ${params.token}`;
    }

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Obtiene estado desde caché
   */
  private getCachedStatus(key: string): SubscriptionStatus | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expires_at) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Guarda estado en caché
   */
  private setCachedStatus(key: string, status: SubscriptionStatus): void {
    const now = Date.now();
    this.cache.set(key, {
      data: status,
      timestamp: now,
      expires_at: now + this.cacheExpiry
    });
  }

  /**
   * Modo offline - obtiene estado guardado localmente
   */
  private getOfflineStatus(tenantId: string, app: string): SubscriptionStatus | null {
    try {
      // En Node.js usaríamos fs, en browser localStorage
      const key = `forvara_offline_${tenantId}_${app}`;
      
      let stored: string | null = null;
      
      // Detectar entorno
      if (typeof window !== 'undefined' && window.localStorage) {
        // Browser
        stored = localStorage.getItem(key);
      } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        // Node.js - aquí podrías usar fs para leer un archivo
        // stored = fs.readFileSync(`./cache/${key}.json`, 'utf8');
        return null; // Por simplicidad, no implementamos fs aquí
      }

      if (!stored) return null;

      const offlineData: OfflineStatus = JSON.parse(stored);
      
      // Verificar si no ha expirado
      const expiresAt = new Date(offlineData.expires_at);
      if (expiresAt <= new Date()) {
        return {
          active: false,
          plan: 'free',
          status: 'expired',
          expires_at: offlineData.expires_at,
          features: {
            max_users: 1,
            max_storage_gb: 0,
            enabled_modules: [],
            rate_limits: { requests_per_minute: 10 }
          },
          error: 'Subscription expired offline'
        };
      }

      // TODO: Verificar firma JWT aquí
      // if (!this.verifyJWTSignature(offlineData.signature)) {
      //   throw new Error('Invalid offline signature');
      // }

      return {
        active: true,
        plan: offlineData.plan as any,
        status: 'active',
        expires_at: offlineData.expires_at,
        features: {
          max_users: 10,
          max_storage_gb: 5,
          enabled_modules: ['core', 'inventario'],
          rate_limits: { requests_per_minute: 100 }
        }
      };
    } catch (error) {
      console.warn('Error reading offline status:', error);
      return null;
    }
  }

  /**
   * Guarda estado para modo offline
   */
  async saveOfflineStatus(tenantId: string, app: string, status: SubscriptionStatus): Promise<void> {
    if (!status.active || !status.expires_at) return;

    const key = `forvara_offline_${tenantId}_${app}`;
    const offlineData: OfflineStatus = {
      plan: status.plan,
      expires_at: status.expires_at,
      signature: 'jwt_signature_here', // TODO: Implementar JWT signing
      cached_at: new Date().toISOString()
    };

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, JSON.stringify(offlineData));
      }
      // En Node.js guardarías en un archivo
    } catch (error) {
      console.warn('Error saving offline status:', error);
    }
  }

  /**
   * Limpia caché
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Obtiene información del usuario actual
   */
  async getCurrentUser(): Promise<any> {
    if (!this.supabase) {
      throw new Error('Supabase not configured for user operations');
    }

    const { data, error } = await this.supabase.rpc('get_usuario_actual');
    
    if (error) {
      throw new Error(`Error getting current user: ${error.message}`);
    }

    return data;
  }
}

// =============================================================================
// FUNCIONES DE CONVENIENCIA
// =============================================================================

/**
 * Función simple para verificar suscripción
 */
export async function verifySubscription(params: VerifySubscriptionParams & { 
  config: ForvaraConfig 
}): Promise<boolean> {
  const client = new ForvaraClient(params.config);
  try {
    const status = await client.verifySubscription(params);
    return status.active;
  } catch (error) {
    console.error('Subscription verification failed:', error);
    return false;
  }
}

/**
 * Middleware para Express.js
 */
export function createSubscriptionMiddleware(config: ForvaraConfig, app: string = 'elaris') {
  const client = new ForvaraClient(config);

  return async (req: any, res: any, next: any) => {
    try {
      const tenantId = req.headers['x-tenant-id'];
      const token = req.headers['authorization']?.split(' ')[1];

      if (!tenantId) {
        return res.status(400).json({ 
          error: 'X-Tenant-ID header required' 
        });
      }

      const status = await client.verifySubscription({
        tenantId,
        token,
        app,
        userId: req.user?.id
      });

      if (!status.active) {
        return res.status(402).json({
          error: 'Active subscription required',
          plan: status.plan,
          status: status.status,
          expires_at: status.expires_at
        });
      }

      // Añadir info de suscripción al request
      req.subscription = status;
      next();
    } catch (error) {
      console.error('Subscription middleware error:', error);
      res.status(500).json({
        error: 'Subscription verification failed'
      });
    }
  };
}

// =============================================================================
// UTILIDADES
// =============================================================================

/**
 * Verifica si un plan tiene acceso a un módulo específico
 */
export function hasModuleAccess(status: SubscriptionStatus, module: string): boolean {
  return status.active && status.features.enabled_modules.includes(module);
}

/**
 * Verifica si se puede añadir más usuarios
 */
export function canAddUsers(status: SubscriptionStatus, currentUsers: number): boolean {
  return status.active && currentUsers < status.features.max_users;
}

/**
 * Calcula días restantes de suscripción
 */
export function getDaysRemaining(status: SubscriptionStatus): number | null {
  if (!status.expires_at) return null;
  
  const expiresAt = new Date(status.expires_at);
  const now = new Date();
  const diffTime = expiresAt.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}
export default ForvaraClient;
