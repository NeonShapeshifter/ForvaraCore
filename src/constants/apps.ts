import { SubscriptionStatus } from './index';

/**
 * Aplicaciones del ecosistema Forvara
 */

// Re-export for convenience
export { SubscriptionStatus };
export interface ForvaraApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  category: AppCategory;
  status: AppStatus;
  requiredPermissions: string[];
  features: string[];
  pricing: {
    monthly: number;
    yearly: number;
    currency: string;
  };
}

export enum AppCategory {
  SYSTEM = 'system',
  BUSINESS = 'business',
  COMMUNICATION = 'communication',
  ANALYTICS = 'analytics',
  OPERATIONS = 'operations',
  FINANCE = 'finance',
  HR = 'hr',
  MARKETING = 'marketing'
}

export enum AppStatus {
  ACTIVE = 'active',
  BETA = 'beta',
  COMING_SOON = 'coming_soon',
  DEPRECATED = 'deprecated',
  MAINTENANCE = 'maintenance'
}

export const FORVARA_APPS: Record<string, ForvaraApp> = {
  hub: {
    id: 'hub',
    name: 'Forvara Hub',
    description: 'Centro de control y gestión del ecosistema',
    icon: 'home',
    url: 'https://hub.forvara.com',
    category: AppCategory.SYSTEM,
    status: AppStatus.ACTIVE,
    requiredPermissions: [],
    features: [
      'dashboard',
      'user_management',
      'billing',
      'settings'
    ],
    pricing: {
      monthly: 0,
      yearly: 0,
      currency: 'USD'
    }
  },
  
  erp: {
    id: 'erp',
    name: 'Forvara ERP',
    description: 'Sistema de planificación de recursos empresariales',
    icon: 'building',
    url: 'https://erp.forvara.com',
    category: AppCategory.BUSINESS,
    status: AppStatus.ACTIVE,
    requiredPermissions: ['erp.access'],
    features: [
      'inventory',
      'sales',
      'purchases',
      'accounting',
      'reports'
    ],
    pricing: {
      monthly: 49.99,
      yearly: 499.99,
      currency: 'USD'
    }
  },
  
  mail: {
    id: 'mail',
    name: 'Forvara Mail',
    description: 'Sistema de mensajería y comunicación interna',
    icon: 'mail',
    url: 'https://mail.forvara.com',
    category: AppCategory.COMMUNICATION,
    status: AppStatus.ACTIVE,
    requiredPermissions: ['mail.access'],
    features: [
      'channels',
      'direct_messages',
      'file_sharing',
      'voice_calls',
      'video_calls'
    ],
    pricing: {
      monthly: 9.99,
      yearly: 99.99,
      currency: 'USD'
    }
  },
  
  analytics: {
    id: 'analytics',
    name: 'Forvara Analytics',
    description: 'Análisis de datos y reportes avanzados',
    icon: 'chart-bar',
    url: 'https://analytics.forvara.com',
    category: AppCategory.ANALYTICS,
    status: AppStatus.ACTIVE,
    requiredPermissions: ['analytics.access'],
    features: [
      'dashboards',
      'custom_reports',
      'data_visualization',
      'export',
      'scheduling'
    ],
    pricing: {
      monthly: 29.99,
      yearly: 299.99,
      currency: 'USD'
    }
  },
  
  pos: {
    id: 'pos',
    name: 'Forvara POS',
    description: 'Punto de venta para retail y restaurantes',
    icon: 'shopping-cart',
    url: 'https://pos.forvara.com',
    category: AppCategory.BUSINESS,
    status: AppStatus.ACTIVE,
    requiredPermissions: ['pos.access'],
    features: [
      'sales',
      'inventory_sync',
      'payment_processing',
      'receipts',
      'offline_mode'
    ],
    pricing: {
      monthly: 39.99,
      yearly: 399.99,
      currency: 'USD'
    }
  },
  
  hr: {
    id: 'hr',
    name: 'Forvara HR',
    description: 'Gestión de recursos humanos',
    icon: 'users',
    url: 'https://hr.forvara.com',
    category: AppCategory.HR,
    status: AppStatus.BETA,
    requiredPermissions: ['hr.access'],
    features: [
      'employee_management',
      'attendance',
      'payroll',
      'recruitment',
      'performance'
    ],
    pricing: {
      monthly: 19.99,
      yearly: 199.99,
      currency: 'USD'
    }
  },
  
  crm: {
    id: 'crm',
    name: 'Forvara CRM',
    description: 'Gestión de relaciones con clientes',
    icon: 'user-check',
    url: 'https://crm.forvara.com',
    category: AppCategory.BUSINESS,
    status: AppStatus.COMING_SOON,
    requiredPermissions: ['crm.access'],
    features: [
      'contacts',
      'deals',
      'pipeline',
      'automation',
      'integrations'
    ],
    pricing: {
      monthly: 24.99,
      yearly: 249.99,
      currency: 'USD'
    }
  }
};

/**
 * Obtener apps por categoría
 */
export function getAppsByCategory(category: AppCategory): ForvaraApp[] {
  return Object.values(FORVARA_APPS).filter(app => app.category === category);
}

/**
 * Obtener apps activas
 */
export function getActiveApps(): ForvaraApp[] {
  return Object.values(FORVARA_APPS).filter(app => app.status === AppStatus.ACTIVE);
}

/**
 * IDs de aplicaciones como constantes
 */
export const AppIds = {
  HUB: 'hub',
  ERP: 'erp', 
  MAIL: 'mail',
  ANALYTICS: 'analytics',
  POS: 'pos',
  HR: 'hr',
  CRM: 'crm'
} as const;

/**
 * Verificar si una app requiere suscripción
 */
export function appRequiresSubscription(appId: string): boolean {
  const app = FORVARA_APPS[appId];
  return app ? app.pricing.monthly > 0 : false;
}

/**
 * Check if subscription is active
 */
export function isActiveSubscription(status: string): boolean {
  const activeStatuses = ['active', 'trialing'];
  return activeStatuses.includes(status);
}
