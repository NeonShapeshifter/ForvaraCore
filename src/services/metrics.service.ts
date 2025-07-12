import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { NotFoundError } from '../types';

interface MetricQuery {
  tenantId: string;
  metric: string;
  startDate?: Date;
  endDate?: Date;
  granularity?: 'hour' | 'day' | 'week' | 'month';
  appId?: string;
}

interface DashboardMetrics {
  users: {
    total: number;
    active: number;
    new: number;
  };
  apps: {
    installed: number;
    active: number;
  };
  storage: {
    used: number;
    limit: number;
    percentage: number;
  };
  revenue: {
    monthly: number;
    annual: number;
    growth: number;
  };
}

class MetricsService {
  private getSupabaseClient() {
    return getSupabase();
  }
  private redis = getRedis();

  async getDashboardMetrics(tenantId: string): Promise<DashboardMetrics> {
    try {
      const cacheKey = `metrics:${tenantId}:dashboard`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      // Get user metrics
      const { data: users } = await this.getSupabaseClient()
        .from('company_members')
        .select('user_id, created_at, last_login_at')
        .eq('company_id', tenantId)
        .eq('is_active', true);

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const activeUsers = users?.filter(u => 
        u.last_login_at && new Date(u.last_login_at) > thirtyDaysAgo
      ).length || 0;

      const newUsers = users?.filter(u => 
        new Date(u.created_at) > thirtyDaysAgo
      ).length || 0;

      // Get app metrics
      const { data: apps } = await this.getSupabaseClient()
        .from('app_installations')
        .select('app_id, is_active, last_used_at')
        .eq('tenant_id', tenantId);

      const activeApps = apps?.filter(a => 
        a.is_active && a.last_used_at && new Date(a.last_used_at) > thirtyDaysAgo
      ).length || 0;

      // Get storage metrics
      const { data: storage } = await this.getSupabaseClient()
        .from('companies')
        .select('storage_used, storage_limit')
        .eq('id', tenantId)
        .single();

      // Get revenue metrics (mock for now)
      const revenue = {
        monthly: 0,
        annual: 0,
        growth: 0
      };

      const metrics: DashboardMetrics = {
        users: {
          total: users?.length || 0,
          active: activeUsers,
          new: newUsers
        },
        apps: {
          installed: apps?.length || 0,
          active: activeApps
        },
        storage: {
          used: storage?.storage_used || 0,
          limit: storage?.storage_limit || 5368709120, // 5GB default
          percentage: storage ? (storage.storage_used / storage.storage_limit) * 100 : 0
        },
        revenue
      };

      await this.redis.setex(cacheKey, 300, JSON.stringify(metrics));
      return metrics;
    } catch (error) {
      logger.error('Get dashboard metrics failed:', error);
      throw error;
    }
  }

  async getMetric(query: MetricQuery) {
    try {
      const { tenantId, metric, startDate, endDate, granularity = 'day' } = query;
      
      // This is a simplified implementation
      // In production, you'd query from a proper metrics/analytics table
      const cacheKey = `metrics:${tenantId}:${metric}:${granularity}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      let data: any[] = [];
      
      switch (metric) {
        case 'active_users':
          data = await this.getActiveUsersMetric(tenantId, startDate, endDate, granularity);
          break;
        case 'api_calls':
          data = await this.getApiCallsMetric(tenantId, startDate, endDate, granularity);
          break;
        case 'storage_usage':
          data = await this.getStorageUsageMetric(tenantId, startDate, endDate, granularity);
          break;
        default:
          throw new ValidationError(`Unknown metric: ${metric}`);
      }

      await this.redis.setex(cacheKey, 3600, JSON.stringify(data));
      return data;
    } catch (error) {
      logger.error('Get metric failed:', error);
      throw error;
    }
  }

  private async getActiveUsersMetric(tenantId: string, startDate?: Date, endDate?: Date, granularity?: string) {
    // Mock implementation
    return Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      value: Math.floor(Math.random() * 100) + 50
    }));
  }

  private async getApiCallsMetric(tenantId: string, startDate?: Date, endDate?: Date, granularity?: string) {
    // Mock implementation
    return Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      value: Math.floor(Math.random() * 1000) + 500
    }));
  }

  private async getStorageUsageMetric(tenantId: string, startDate?: Date, endDate?: Date, granularity?: string) {
    // Mock implementation
    return Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      value: Math.floor(Math.random() * 1000000) + 1000000 // bytes
    }));
  }

  async recordEvent(tenantId: string, event: string, metadata?: any) {
    try {
      const { error } = await this.getSupabaseClient()
        .from('analytics_events')
        .insert({
          tenant_id: tenantId,
          event,
          metadata,
          created_at: new Date().toISOString()
        });

      if (error) {
        logger.error('Record event failed:', error);
      }
    } catch (error) {
      // Don't throw, just log - analytics shouldn't break the app
      logger.error('Record event error:', error);
    }
  }
}

export const metricsService = new MetricsService();