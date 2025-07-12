import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';

interface AnalyticsEvent {
  tenantId: string;
  userId?: string;
  event: string;
  properties?: Record<string, any>;
  timestamp?: Date;
}

interface AnalyticsQuery {
  tenantId: string;
  events?: string[];
  startDate: Date;
  endDate: Date;
  groupBy?: 'day' | 'week' | 'month';
  filters?: Record<string, any>;
}

interface AnalyticsResult {
  event: string;
  count: number;
  uniqueUsers: number;
  data: Array<{
    date: string;
    count: number;
    uniqueUsers: number;
  }>;
}

class AnalyticsService {
  private supabase = getSupabase();
  private redis = getRedis();

  async trackEvent(event: AnalyticsEvent) {
    try {
      const { error } = await this.supabase
        .from('analytics_events')
        .insert({
          tenant_id: event.tenantId,
          user_id: event.userId,
          event: event.event,
          properties: event.properties || {},
          created_at: (event.timestamp || new Date()).toISOString()
        });

      if (error) {
        logger.error('Track event failed:', error);
      }

      // Update real-time metrics in Redis
      const dateKey = new Date().toISOString().split('T')[0];
      const eventKey = `analytics:${event.tenantId}:${dateKey}:${event.event}`;
      await this.redis.incr(eventKey);
      await this.redis.expire(eventKey, 86400 * 30); // 30 days

      if (event.userId) {
        const userKey = `analytics:${event.tenantId}:${dateKey}:users`;
        await this.redis.sadd(userKey, event.userId);
        await this.redis.expire(userKey, 86400 * 30);
      }
    } catch (error) {
      // Don't throw - analytics shouldn't break the app
      logger.error('Analytics track error:', error);
    }
  }

  async getEventAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult[]> {
    try {
      const cacheKey = `analytics:${query.tenantId}:${JSON.stringify(query)}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const results: AnalyticsResult[] = [];

      for (const event of (query.events || [])) {
        const { data } = await this.supabase
          .from('analytics_events')
          .select('event, user_id, created_at')
          .eq('tenant_id', query.tenantId)
          .eq('event', event)
          .gte('created_at', query.startDate.toISOString())
          .lte('created_at', query.endDate.toISOString());

        if (data) {
          const grouped = this.groupByPeriod(data, query.groupBy || 'day');
          results.push({
            event,
            count: data.length,
            uniqueUsers: new Set(data.map(d => d.user_id).filter(Boolean)).size,
            data: grouped
          });
        }
      }

      await this.redis.setex(cacheKey, 3600, JSON.stringify(results));
      return results;
    } catch (error) {
      logger.error('Get event analytics failed:', error);
      throw error;
    }
  }

  async getFunnelAnalytics(tenantId: string, events: string[], startDate: Date, endDate: Date) {
    try {
      const funnel = [];
      let previousUsers = new Set<string>();

      for (let i = 0; i < events.length; i++) {
        const { data } = await this.supabase
          .from('analytics_events')
          .select('user_id')
          .eq('tenant_id', tenantId)
          .eq('event', events[i])
          .gte('created_at', startDate.toISOString())
          .lte('created_at', endDate.toISOString());

        const users = new Set(data?.map(d => d.user_id).filter(Boolean) || []);
        
        if (i === 0) {
          previousUsers = users;
        } else {
          // Only keep users who were in the previous step
          const intersection = new Set([...users].filter(x => previousUsers.has(x)));
          previousUsers = intersection;
        }

        funnel.push({
          event: events[i],
          users: previousUsers.size,
          dropoff: i > 0 ? 
            ((funnel[i-1].users - previousUsers.size) / funnel[i-1].users * 100).toFixed(2) : 
            0
        });
      }

      return funnel;
    } catch (error) {
      logger.error('Get funnel analytics failed:', error);
      throw error;
    }
  }

  async getRetentionAnalytics(tenantId: string, cohortDate: Date, days: number = 30) {
    try {
      // Get users who performed any action on the cohort date
      const { data: cohortUsers } = await this.supabase
        .from('analytics_events')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', cohortDate.toISOString())
        .lt('created_at', new Date(cohortDate.getTime() + 86400000).toISOString());

      const cohortUserIds = new Set(cohortUsers?.map(u => u.user_id).filter(Boolean) || []);
      const retention = [];

      for (let day = 0; day < days; day++) {
        const checkDate = new Date(cohortDate.getTime() + day * 86400000);
        
        const { data: activeUsers } = await this.supabase
          .from('analytics_events')
          .select('user_id')
          .eq('tenant_id', tenantId)
          .in('user_id', Array.from(cohortUserIds))
          .gte('created_at', checkDate.toISOString())
          .lt('created_at', new Date(checkDate.getTime() + 86400000).toISOString());

        const activeUserIds = new Set(activeUsers?.map(u => u.user_id) || []);
        
        retention.push({
          day,
          date: checkDate.toISOString().split('T')[0],
          retained: activeUserIds.size,
          percentage: (activeUserIds.size / cohortUserIds.size * 100).toFixed(2)
        });
      }

      return {
        cohortSize: cohortUserIds.size,
        cohortDate: cohortDate.toISOString().split('T')[0],
        retention
      };
    } catch (error) {
      logger.error('Get retention analytics failed:', error);
      throw error;
    }
  }

  private groupByPeriod(data: any[], period: 'day' | 'week' | 'month') {
    const grouped = new Map<string, { count: number; users: Set<string> }>();

    for (const item of data) {
      const date = new Date(item.created_at);
      let key: string;

      switch (period) {
        case 'day':
          key = date.toISOString().split('T')[0];
          break;
        case 'week':
          const week = this.getWeekNumber(date);
          key = `${date.getFullYear()}-W${week}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      if (!grouped.has(key)) {
        grouped.set(key, { count: 0, users: new Set() });
      }

      const group = grouped.get(key)!;
      group.count++;
      if (item.user_id) {
        group.users.add(item.user_id);
      }
    }

    return Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      count: data.count,
      uniqueUsers: data.users.size
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }
}

export const analyticsService = new AnalyticsService();