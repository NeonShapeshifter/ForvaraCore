import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { CACHE_KEYS } from '../constants';

const supabase = getSupabase();
const redis = getRedis();

export interface TenantUsage {
  storage_used: number;
  storage_limit: number;
  users_count: number;
  users_limit: number;
  apps_count: number;
  apps_limit: number;
  api_calls_today: number;
  api_calls_limit: number;
}

export interface TenantLimits {
  max_storage_bytes: number;
  max_users: number;
  max_apps: number;
  max_api_calls_daily: number;
  features: string[];
}

export interface UsageAnalysis {
  storage_percentage: number;
  users_percentage: number;
  apps_percentage: number;
  api_calls_percentage: number;
  warnings: string[];
  recommendations: string[];
}

/**
 * Get current usage for a tenant
 */
export async function getTenantUsage(tenantId: string): Promise<TenantUsage> {
  try {
    const cacheKey = CACHE_KEYS.TENANT_USAGE(tenantId);
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Get storage usage
    const { data: storageData } = await supabase
      .from('files')
      .select('size_bytes')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);
    
    const storageUsed = storageData?.reduce((sum, file) => sum + file.size_bytes, 0) || 0;

    // Get user count
    const { count: usersCount } = await supabase
      .from('company_members')
      .select('*', { count: 'exact' })
      .eq('company_id', tenantId);

    // Get app count
    const { count: appsCount } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing']);

    // Get API calls today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count: apiCallsToday } = await supabase
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .gte('created_at', today.toISOString());

    // Get limits from subscription
    const limits = await calculateTenantLimits(tenantId);

    const usage: TenantUsage = {
      storage_used: storageUsed,
      storage_limit: limits.max_storage_bytes,
      users_count: usersCount || 0,
      users_limit: limits.max_users,
      apps_count: appsCount || 0,
      apps_limit: limits.max_apps,
      api_calls_today: apiCallsToday || 0,
      api_calls_limit: limits.max_api_calls_daily
    };

    // Cache for 5 minutes
    await redis.setex(cacheKey, 300, JSON.stringify(usage));

    return usage;
  } catch (error) {
    console.error('Error getting tenant usage:', error);
    throw error;
  }
}

/**
 * Calculate tenant limits based on subscriptions
 */
export async function calculateTenantLimits(tenantId: string): Promise<TenantLimits> {
  try {
    // Get active subscriptions
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select(`
        *,
        subscription_plans (
          *,
          plan_features (
            feature_id,
            value,
            features (*)
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .in('status', ['active', 'trialing']);

    // Base limits (free tier)
    let limits: TenantLimits = {
      max_storage_bytes: 5 * 1024 * 1024 * 1024, // 5GB
      max_users: 5,
      max_apps: 1,
      max_api_calls_daily: 10000,
      features: ['basic']
    };

    // Aggregate limits from all subscriptions
    if (subscriptions && subscriptions.length > 0) {
      subscriptions.forEach(sub => {
        const plan = sub.subscription_plans;
        if (!plan) return;

        // Apply plan features
        plan.plan_features?.forEach((pf: any) => {
          const feature = pf.features;
          if (!feature) return;

          switch (feature.key) {
            case 'max_storage_gb':
              limits.max_storage_bytes = Math.max(
                limits.max_storage_bytes,
                parseInt(pf.value) * 1024 * 1024 * 1024
              );
              break;
            case 'max_users':
              limits.max_users = Math.max(limits.max_users, parseInt(pf.value));
              break;
            case 'max_apps':
              limits.max_apps = Math.max(limits.max_apps, parseInt(pf.value));
              break;
            case 'max_api_calls_daily':
              limits.max_api_calls_daily = Math.max(
                limits.max_api_calls_daily,
                parseInt(pf.value)
              );
              break;
            default:
              if (!limits.features.includes(feature.key)) {
                limits.features.push(feature.key);
              }
          }
        });
      });
    }

    return limits;
  } catch (error) {
    console.error('Error calculating tenant limits:', error);
    throw error;
  }
}

/**
 * Analyze usage and provide insights
 */
export async function analyzeUsage(tenantId: string): Promise<UsageAnalysis> {
  try {
    const usage = await getTenantUsage(tenantId);
    
    const storagePercentage = (usage.storage_used / usage.storage_limit) * 100;
    const usersPercentage = (usage.users_count / usage.users_limit) * 100;
    const appsPercentage = (usage.apps_count / usage.apps_limit) * 100;
    const apiCallsPercentage = (usage.api_calls_today / usage.api_calls_limit) * 100;

    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Check storage
    if (storagePercentage >= 90) {
      warnings.push('Storage usage is above 90%');
      recommendations.push('Consider upgrading your storage plan');
    } else if (storagePercentage >= 75) {
      warnings.push('Storage usage is above 75%');
    }

    // Check users
    if (usersPercentage >= 100) {
      warnings.push('User limit reached');
      recommendations.push('Upgrade to add more users');
    } else if (usersPercentage >= 80) {
      warnings.push('Approaching user limit');
    }

    // Check apps
    if (appsPercentage >= 100) {
      warnings.push('App limit reached');
      recommendations.push('Upgrade to install more apps');
    }

    // Check API calls
    if (apiCallsPercentage >= 90) {
      warnings.push('API call limit nearly reached');
      recommendations.push('Consider upgrading for more API calls');
    }

    return {
      storage_percentage: storagePercentage,
      users_percentage: usersPercentage,
      apps_percentage: appsPercentage,
      api_calls_percentage: apiCallsPercentage,
      warnings,
      recommendations
    };
  } catch (error) {
    console.error('Error analyzing usage:', error);
    throw error;
  }
}