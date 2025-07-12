export * from './errors';
export * from './roles';
export * from './apps';
export * from './limits';
export * from './regex';
export * from './events';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  TRIALING = 'trialing',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
  UNPAID = 'unpaid',
  INCOMPLETE = 'incomplete',
  INCOMPLETE_EXPIRED = 'incomplete_expired'
}

export const CACHE_KEYS = {
  USER: (id: string) => `user:${id}`,
  TENANT: (id: string) => `tenant:${id}`,
  SUBSCRIPTION: (id: string) => `subscription:${id}`,
  APP: (id: string) => `app:${id}`,
  PLANS: 'plans:all',
  APP_PLANS: (appId: string) => `plans:${appId}`,
  TENANT_USAGE: (tenantId: string) => `usage:${tenantId}`,
  TENANT_MEMBERS: (tenantId: string) => `members:${tenantId}`,
  USER_SESSIONS: (userId: string) => `sessions:${userId}`,
  NOTIFICATIONS: (userId: string) => `notifications:${userId}`
};
