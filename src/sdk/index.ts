import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TIPOS MEJORADOS
// =============================================================================

export interface ForvaraConfig {
  apiUrl: string;
  apiKey?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  appId: string; // NUEVO: Identificador de la app
  enableOffline?: boolean;
  cacheExpiry?: number; // en milisegundos
  debug?: boolean;
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
  user_role?: string;
  tenant_info?: {
    id: string;
    role: string;
  };
  offline_token?: string; // AGREGADO: Para tokens offline
  error?: string;
}

export interface ForvaraUser {
  id: string;
  nombre: string;
  apellido: string;
  email?: string;
  telefono: string;
  avatar_url?: string;
  tenants: Array<{
    id: string;
    nombre: string;
    ruc: string;
    rol: string;
    activo: boolean;
  }>;
}

export interface LoginResponse {
  success: boolean;
  user?: ForvaraUser;
  tenants?: Array<any>;
  token?: string;
  session?: any;
  error?: string;
  code?: string;
}

export interface CacheEntry {
  data: any;
  timestamp: number;
  expires_at: number;
}

export interface AppInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  category: string;
  status: 'active' | 'beta' | 'maintenance';
  subscription?: any;
}

// =============================================================================
// EVENTOS DEL SDK
// =============================================================================

export type ForvaraEvent = 
  | 'auth:login'
  | 'auth:logout'
  | 'auth:tenant-changed'
  | 'subscription:updated'
  | 'subscription:expired'
  | 'connection:online'
  | 'connection:offline';

export interface EventPayload {
  type: ForvaraEvent;
  data?: any;
  timestamp: number;
}

// =============================================================================
// CLIENTE FORVARA MEJORADO
// =============================================================================

export class ForvaraClient {
  private config: ForvaraConfig;
  private supabase?: SupabaseClient;
  private cache: Map<string, CacheEntry> = new Map();
  private currentUser: ForvaraUser | null = null;
  private currentTenant: string | null = null;
  private token: string | null = null;
  private eventListeners: Map<ForvaraEvent, Function[]> = new Map();
  private isOnline: boolean = true;

  constructor(config: ForvaraConfig) {
    this.config = {
      enableOffline: true,
      cacheExpiry: 5 * 60 * 1000, // 5 minutos
      debug: false,
      ...config
    };
    
    if (config.supabaseUrl && config.supabaseKey) {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
    }

    // Configurar detección de conectividad
    this.setupConnectivityMonitoring();
    
    // Restaurar sesión desde storage
    this.restoreSession();

    this.debug('ForvaraClient initialized', { appId: this.config.appId });
  }

  // =============================================================================
  // MÉTODOS DE AUTENTICACIÓN
  // =============================================================================

  /**
   * Login con email/teléfono y contraseña
   */
  async login(identifier: string, password: string): Promise<LoginResponse> {
    try {
      this.debug('Attempting login', { identifier });

      const isEmail = identifier.includes('@');
      const payload = isEmail 
        ? { email: identifier, password }
        : { telefono: identifier, password };

      const response = await this.makeRequest('POST', '/auth/login', payload);

      if (response.user) {
        this.currentUser = response.user;
        this.token = response.token;
        
        // Guardar en storage
        this.saveToStorage('forvara_user', response.user);
        this.saveToStorage('forvara_token', response.token);
        
        this.emit('auth:login', { user: response.user });
        this.debug('Login successful');
      }

      return response;
    } catch (error) {
      this.debug('Login failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Login failed'
      };
    }
  }

  /**
   * Registro de nuevo usuario
   */
  async register(userData: {
    nombre: string;
    apellido: string;
    telefono: string;
    email?: string;
    password: string;
  }): Promise<LoginResponse> {
    try {
      this.debug('Attempting registration');
      
      const response = await this.makeRequest('POST', '/auth/register', userData);
      
      this.debug('Registration successful');
      return { success: true, ...response };
    } catch (error) {
      this.debug('Registration failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed'
      };
    }
  }

  /**
   * Seleccionar tenant activo
   */
  async selectTenant(tenantId: string): Promise<boolean> {
    try {
      this.debug('Selecting tenant', { tenantId });

      const response = await this.makeRequest('POST', '/auth/select-tenant', {
        tenant_id: tenantId
      });

      if (response.token) {
        this.token = response.token;
        this.currentTenant = tenantId;
        
        this.saveToStorage('forvara_token', response.token);
        this.saveToStorage('forvara_current_tenant', tenantId);
        
        this.emit('auth:tenant-changed', { tenantId, tenant: response.tenant });
        this.debug('Tenant selected successfully');
        return true;
      }

      return false;
    } catch (error) {
      this.debug('Tenant selection failed', error);
      return false;
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      if (this.token) {
        await this.makeRequest('POST', '/auth/logout');
      }
    } catch (error) {
      this.debug('Logout request failed', error);
    } finally {
      // Limpiar estado local
      this.currentUser = null;
      this.currentTenant = null;
      this.token = null;
      this.cache.clear();
      
      // Limpiar storage
      this.removeFromStorage('forvara_user');
      this.removeFromStorage('forvara_token');
      this.removeFromStorage('forvara_current_tenant');
      
      this.emit('auth:logout');
      this.debug('Logout completed');
    }
  }

  // =============================================================================
  // MÉTODOS DE SUSCRIPCIÓN
  // =============================================================================

  /**
   * Verificar estado de suscripción
   */
  async verifySubscription(params?: { tenantId?: string }): Promise<SubscriptionStatus> {
    const tenantId = params?.tenantId || this.currentTenant;
    const cacheKey = `subscription_${tenantId}_${this.config.appId}`;
    
    // Verificar caché primero
    if (this.config.enableOffline) {
      const cached = this.getCachedData(cacheKey);
      if (cached) {
        this.debug('Returning cached subscription status');
        return cached;
      }
    }

    try {
      // Verificación online
      const subscription = await this.fetchSubscriptionStatus(tenantId);
      
      // Guardar en caché
      if (this.config.enableOffline) {
        this.setCachedData(cacheKey, subscription);
        
        // Guardar token offline si está disponible
        if (subscription.offline_token) {
          this.saveToStorage(`forvara_offline_${tenantId}_${this.config.appId}`, {
            token: subscription.offline_token,
            cached_at: Date.now()
          });
        }
      }
      
      return subscription;
    } catch (error) {
      this.debug('Online verification failed, trying offline', error);
      
      // Modo offline
      if (this.config.enableOffline) {
        const offlineStatus = this.getOfflineStatus(tenantId);
        if (offlineStatus) {
          return offlineStatus;
        }
      }
      
      throw error;
    }
  }

  /**
   * Verificar acceso a un módulo específico
   */
  async hasModuleAccess(module: string, tenantId?: string): Promise<boolean> {
    try {
      const status = await this.verifySubscription({ tenantId });
      return status.active && status.features.enabled_modules.includes(module);
    } catch (error) {
      this.debug('Module access check failed', error);
      return false;
    }
  }

  /**
   * Verificar si se pueden añadir más usuarios
   */
  async canAddUsers(currentCount: number, tenantId?: string): Promise<boolean> {
    try {
      const status = await this.verifySubscription({ tenantId });
      return status.active && currentCount < status.features.max_users;
    } catch (error) {
      this.debug('User limit check failed', error);
      return false;
    }
  }

  /**
   * Obtener límites actuales
   */
  async getLimits(tenantId?: string): Promise<SubscriptionStatus['features'] | null> {
    try {
      const status = await this.verifySubscription({ tenantId });
      return status.features;
    } catch (error) {
      this.debug('Get limits failed', error);
      return null;
    }
  }

  // =============================================================================
  // MÉTODOS DE APPS
  // =============================================================================

  /**
   * Obtener apps disponibles
   */
  async getAvailableApps(): Promise<AppInfo[]> {
    try {
      const response = await this.makeRequest('GET', '/apps');
      return response.apps || [];
    } catch (error) {
      this.debug('Get apps failed', error);
      return [];
    }
  }

  /**
   * Instalar app para el tenant actual
   */
  async installApp(appId: string, plan: string = 'trial'): Promise<boolean> {
    try {
      await this.makeRequest('POST', `/apps/${appId}/install`, { plan });
      this.debug('App installed successfully', { appId, plan });
      return true;
    } catch (error) {
      this.debug('App installation failed', error);
      return false;
    }
  }

  // =============================================================================
  // MÉTODOS DE USUARIO
  // =============================================================================

  /**
   * Obtener usuario actual
   */
  getCurrentUser(): ForvaraUser | null {
    return this.currentUser;
  }

  /**
   * Obtener tenant actual
   */
  getCurrentTenant(): string | null {
    return this.currentTenant;
  }

  /**
   * Verificar si está autenticado
   */
  isAuthenticated(): boolean {
    return !!this.token && !!this.currentUser;
  }

  /**
   * Obtener perfil completo del usuario
   */
  async getProfile(): Promise<ForvaraUser | null> {
    try {
      const response = await this.makeRequest('GET', '/users/me');
      return response.data || null;
    } catch (error) {
      this.debug('Get profile failed', error);
      return null;
    }
  }

  /**
   * Actualizar perfil
   */
  async updateProfile(data: Partial<ForvaraUser>): Promise<boolean> {
    try {
      await this.makeRequest('PUT', '/users/me', data);
      
      // Actualizar usuario local
      if (this.currentUser) {
        this.currentUser = { ...this.currentUser, ...data };
        this.saveToStorage('forvara_user', this.currentUser);
      }
      
      return true;
    } catch (error) {
      this.debug('Update profile failed', error);
      return false;
    }
  }

  // =============================================================================
  // MÉTODOS PRIVADOS
  // =============================================================================

  private async fetchSubscriptionStatus(tenantId: string | null): Promise<SubscriptionStatus> {
    const params = new URLSearchParams();
    if (tenantId) params.set('tenant_id', tenantId);
    params.set('app', this.config.appId);

    const response = await this.makeRequest('GET', `/subscription/status?${params.toString()}`);
    return response;
  }

  private getOfflineStatus(tenantId: string | null): SubscriptionStatus | null {
    if (!tenantId) return null;

    try {
      const key = `forvara_offline_${tenantId}_${this.config.appId}`;
      const stored = this.getFromStorage(key);
      
      if (!stored || !stored.token) return null;

      // Verificar si el token offline sigue siendo válido
      const tokenAge = Date.now() - stored.cached_at;
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días

      if (tokenAge > maxAge) {
        this.removeFromStorage(key);
        return null;
      }

      // Hacer una verificación offline del token
      return this.verifyOfflineToken(stored.token);
    } catch (error) {
      this.debug('Offline status check failed', error);
      return null;
    }
  }

  private async verifyOfflineToken(token: string): Promise<SubscriptionStatus> {
    try {
      const response = await this.makeRequest('POST', '/subscription/verify-offline', { token });
      
      return {
        active: response.active,
        plan: response.plan,
        status: response.active ? 'active' : 'expired',
        expires_at: response.expires_at,
        features: response.features
      };
    } catch (error) {
      this.debug('Offline token verification failed', error);
      // Retornar estado inactivo en lugar de null
      return {
        active: false,
        plan: 'free',
        status: 'expired',
        expires_at: null,
        features: {
          max_users: 1,
          max_storage_gb: 0,
          enabled_modules: [],
          rate_limits: { requests_per_minute: 10 }
        },
        error: 'Offline verification failed'
      };
    }
  }

  private async makeRequest(method: string, endpoint: string, body?: any): Promise<any> {
    const url = `${this.config.apiUrl}/api${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    if (this.currentTenant) {
      headers['X-Tenant-ID'] = this.currentTenant;
    }

    headers['X-App-ID'] = this.config.appId;

    const config: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      config.body = JSON.stringify(body);
    }

    this.debug(`Making ${method} request to ${endpoint}`, { body });

    const response = await fetch(url, config);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // =============================================================================
  // GESTIÓN DE CACHÉ
  // =============================================================================

  private getCachedData(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expires_at) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setCachedData(key: string, data: any): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expires_at: now + (this.config.cacheExpiry || 5 * 60 * 1000)
    });
  }

  private clearCache(): void {
    this.cache.clear();
  }

  // =============================================================================
  // GESTIÓN DE STORAGE
  // =============================================================================

  private saveToStorage(key: string, data: any): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, JSON.stringify(data));
      }
    } catch (error) {
      this.debug('Failed to save to storage', error);
    }
  }

  private getFromStorage(key: string): any {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      }
    } catch (error) {
      this.debug('Failed to read from storage', error);
    }
    return null;
  }

  private removeFromStorage(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      this.debug('Failed to remove from storage', error);
    }
  }

  private restoreSession(): void {
    try {
      const user = this.getFromStorage('forvara_user');
      const token = this.getFromStorage('forvara_token');
      const tenant = this.getFromStorage('forvara_current_tenant');

      if (user && token) {
        this.currentUser = user;
        this.token = token;
        this.currentTenant = tenant;
        this.debug('Session restored from storage');
      }
    } catch (error) {
      this.debug('Failed to restore session', error);
    }
  }

  // =============================================================================
  // GESTIÓN DE EVENTOS
  // =============================================================================

  on(event: ForvaraEvent, callback: Function): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(callback);
  }

  off(event: ForvaraEvent, callback: Function): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  private emit(event: ForvaraEvent, data?: any): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const payload: EventPayload = {
        type: event,
        data,
        timestamp: Date.now()
      };
      
      listeners.forEach(callback => {
        try {
          callback(payload);
        } catch (error) {
          this.debug('Event listener error', error);
        }
      });
    }
  }

  // =============================================================================
  // MONITOREO DE CONECTIVIDAD
  // =============================================================================

  private setupConnectivityMonitoring(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.isOnline = true;
        this.emit('connection:online');
        this.debug('Connection restored');
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        this.emit('connection:offline');
        this.debug('Connection lost');
      });

      this.isOnline = navigator.onLine;
    }
  }

  /**
   * Verificar si hay conexión a internet
   */
  isConnected(): boolean {
    return this.isOnline;
  }

  // =============================================================================
  // UTILIDADES
  // =============================================================================

  private debug(message: string, data?: any): void {
    if (this.config.debug) {
      console.log(`[Forvara SDK] ${message}`, data || '');
    }
  }

  /**
   * Obtener versión del SDK
   */
  getVersion(): string {
    return '2.0.0';
  }

  /**
   * Obtener información de configuración
   */
  getConfig(): Partial<ForvaraConfig> {
    return {
      apiUrl: this.config.apiUrl,
      appId: this.config.appId,
      enableOffline: this.config.enableOffline,
      cacheExpiry: this.config.cacheExpiry
    };
  }
}

// =============================================================================
// FUNCIONES DE CONVENIENCIA
// =============================================================================

/**
 * Crear instancia del cliente Forvara
 */
export function createForvaraClient(config: ForvaraConfig): ForvaraClient {
  return new ForvaraClient(config);
}

/**
 * Función simple para verificar suscripción
 */
export async function verifySubscription(params: {
  apiUrl: string;
  appId: string;
  tenantId: string;
  token?: string;
}): Promise<boolean> {
  try {
    const client = new ForvaraClient({
      apiUrl: params.apiUrl,
      appId: params.appId
    });
    
    // Si hay token, establecerlo
    if (params.token) {
      (client as any).token = params.token;
    }
    
    const status = await client.verifySubscription({ tenantId: params.tenantId });
    return status.active;
  } catch (error) {
    console.error('Subscription verification failed:', error);
    return false;
  }
}

/**
 * Middleware para Express.js
 */
export function createSubscriptionMiddleware(config: {
  apiUrl: string;
  appId: string;
  requiredModules?: string[];
}) {
  return async (req: any, res: any, next: any) => {
    try {
      const tenantId = req.headers['x-tenant-id'];
      const token = req.headers['authorization']?.split(' ')[1];

      if (!tenantId) {
        return res.status(400).json({ 
          error: 'X-Tenant-ID header required',
          code: 'MISSING_TENANT_ID'
        });
      }

      const client = new ForvaraClient(config);
      (client as any).token = token;

      const status = await client.verifySubscription({ tenantId });

      if (!status.active) {
        return res.status(402).json({
          error: 'Active subscription required',
          plan: status.plan,
          status: status.status,
          expires_at: status.expires_at
        });
      }

      // Verificar módulos requeridos
      if (config.requiredModules) {
        for (const module of config.requiredModules) {
          if (!status.features.enabled_modules.includes(module)) {
            return res.status(403).json({
              error: `Module '${module}' not available in current plan`,
              required_plan: 'pro'
            });
          }
        }
      }

      // Añadir info de suscripción al request
      req.subscription = status;
      req.forvara = { tenantId, userRole: status.user_role };
      
      next();
    } catch (error) {
      console.error('Subscription middleware error:', error);
      res.status(500).json({
        error: 'Subscription verification failed',
        code: 'VERIFICATION_ERROR'
      });
    }
  };
}

// =============================================================================
// UTILIDADES ADICIONALES
// =============================================================================

/**
 * Verificar si un plan tiene acceso a un módulo específico
 */
export function hasModuleAccess(status: SubscriptionStatus, module: string): boolean {
  return status.active && status.features.enabled_modules.includes(module);
}

/**
 * Calcular días restantes de suscripción
 */
export function getDaysRemaining(status: SubscriptionStatus): number | null {
  if (!status.expires_at) return null;
  
  const expiresAt = new Date(status.expires_at);
  const now = new Date();
  const diffTime = expiresAt.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

/**
 * Verificar si una suscripción está cerca de expirar
 */
export function isExpiringSoon(status: SubscriptionStatus, daysThreshold: number = 7): boolean {
  const daysRemaining = getDaysRemaining(status);
  return daysRemaining !== null && daysRemaining <= daysThreshold;
}

export default ForvaraClient;
