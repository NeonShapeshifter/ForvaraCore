import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { analyticsService } from './analytics.service';
import { metricsService } from './metrics.service';
import { NotFoundError } from '../types';

interface ReportConfig {
  id: string;
  tenantId: string;
  name: string;
  type: 'usage' | 'billing' | 'security' | 'custom';
  schedule?: 'daily' | 'weekly' | 'monthly';
  filters?: Record<string, any>;
  recipients?: string[];
  isActive: boolean;
}

interface ReportData {
  summary: Record<string, any>;
  charts: Array<{
    title: string;
    type: 'line' | 'bar' | 'pie';
    data: any[];
  }>;
  tables: Array<{
    title: string;
    headers: string[];
    rows: any[][];
  }>;
  period: {
    start: string;
    end: string;
  };
}

class ReportService {
  private supabase = getSupabase();
  private redis = getRedis();

  async generateUsageReport(tenantId: string, startDate: Date, endDate: Date): Promise<ReportData> {
    try {
      // Get basic metrics
      const dashboardMetrics = await metricsService.getDashboardMetrics(tenantId);
      
      // Get user activity
      const { data: userActivity } = await this.supabase
        .from('analytics_events')
        .select('event, user_id, created_at')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      // Process data for charts
      const dailyActivity = this.groupByDay(userActivity || [], startDate, endDate);
      const topEvents = this.getTopEvents(userActivity || []);
      const activeUsers = this.getActiveUsers(userActivity || []);

      const report: ReportData = {
        summary: {
          totalUsers: dashboardMetrics.users.total,
          activeUsers: dashboardMetrics.users.active,
          totalEvents: userActivity?.length || 0,
          storageUsed: dashboardMetrics.storage.used,
          storagePercentage: dashboardMetrics.storage.percentage
        },
        charts: [
          {
            title: 'Daily Activity',
            type: 'line',
            data: dailyActivity
          },
          {
            title: 'Top Events',
            type: 'bar',
            data: topEvents
          }
        ],
        tables: [
          {
            title: 'Active Users',
            headers: ['User ID', 'Events', 'Last Activity'],
            rows: activeUsers
          }
        ],
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

      return report;
    } catch (error) {
      logger.error('Generate usage report failed:', error);
      throw error;
    }
  }

  async generateBillingReport(tenantId: string, startDate: Date, endDate: Date): Promise<ReportData> {
    try {
      // Get subscriptions
      const { data: subscriptions } = await this.supabase
        .from('subscriptions')
        .select(`
          *,
          app:apps(name)
        `)
        .eq('tenant_id', tenantId);

      // Calculate billing summary
      const totalMonthlyRevenue = subscriptions?.reduce((sum, sub) => {
        if (sub.billing_cycle === 'monthly') return sum + (sub.amount || 0);
        if (sub.billing_cycle === 'yearly') return sum + ((sub.amount || 0) / 12);
        return sum;
      }, 0) || 0;

      const subscriptionsByStatus = subscriptions?.reduce((acc, sub) => {
        acc[sub.status] = (acc[sub.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      const report: ReportData = {
        summary: {
          totalSubscriptions: subscriptions?.length || 0,
          monthlyRevenue: totalMonthlyRevenue,
          activeSubscriptions: subscriptionsByStatus.active || 0,
          cancelledSubscriptions: subscriptionsByStatus.cancelled || 0
        },
        charts: [
          {
            title: 'Subscriptions by Status',
            type: 'pie',
            data: Object.entries(subscriptionsByStatus).map(([status, count]) => ({
              name: status,
              value: count
            }))
          }
        ],
        tables: [
          {
            title: 'Active Subscriptions',
            headers: ['App', 'Plan', 'Amount', 'Billing Cycle', 'Status'],
            rows: subscriptions?.map(sub => [
              sub.app?.name || 'Unknown',
              sub.plan_id,
              `$${sub.amount || 0}`,
              sub.billing_cycle,
              sub.status
            ]) || []
          }
        ],
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

      return report;
    } catch (error) {
      logger.error('Generate billing report failed:', error);
      throw error;
    }
  }

  async generateSecurityReport(tenantId: string, startDate: Date, endDate: Date): Promise<ReportData> {
    try {
      // Get security-related activities
      const { data: securityEvents } = await this.supabase
        .from('activity_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('action', ['LOGIN', 'LOGOUT', 'PASSWORD_CHANGE', 'PERMISSION_CHANGE'])
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      // Get failed login attempts
      const { data: failedLogins } = await this.supabase
        .from('analytics_events')
        .select('properties, created_at')
        .eq('tenant_id', tenantId)
        .eq('event', 'login_failed')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      const securitySummary = {
        totalSecurityEvents: securityEvents?.length || 0,
        failedLogins: failedLogins?.length || 0,
        passwordChanges: securityEvents?.filter(e => e.action === 'PASSWORD_CHANGE').length || 0,
        permissionChanges: securityEvents?.filter(e => e.action === 'PERMISSION_CHANGE').length || 0
      };

      const report: ReportData = {
        summary: securitySummary,
        charts: [
          {
            title: 'Security Events Over Time',
            type: 'line',
            data: this.groupSecurityEventsByDay(securityEvents || [], startDate, endDate)
          }
        ],
        tables: [
          {
            title: 'Recent Security Events',
            headers: ['Date', 'Action', 'User', 'Resource'],
            rows: securityEvents?.slice(0, 50).map(event => [
              new Date(event.created_at).toLocaleDateString(),
              event.action,
              event.user_id,
              event.resource || 'N/A'
            ]) || []
          }
        ],
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        }
      };

      return report;
    } catch (error) {
      logger.error('Generate security report failed:', error);
      throw error;
    }
  }

  async scheduleReport(config: ReportConfig) {
    try {
      const { error } = await this.supabase
        .from('scheduled_reports')
        .insert({
          ...config,
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      // In production, you'd add this to a job queue
      logger.info(`Report scheduled: ${config.name} for tenant ${config.tenantId}`);
      
      return { success: true, reportId: config.id };
    } catch (error) {
      logger.error('Schedule report failed:', error);
      throw error;
    }
  }

  async exportReport(reportData: ReportData, format: 'pdf' | 'csv' | 'json') {
    try {
      switch (format) {
        case 'json':
          return JSON.stringify(reportData, null, 2);
        
        case 'csv':
          // Convert tables to CSV format
          let csv = '';
          for (const table of reportData.tables) {
            csv += `\n${table.title}\n`;
            csv += table.headers.join(',') + '\n';
            csv += table.rows.map(row => row.join(',')).join('\n');
            csv += '\n';
          }
          return csv;
        
        case 'pdf':
          // In production, you'd use a PDF library
          throw new Error('PDF export not implemented');
        
        default:
          throw new ValidationError('Unsupported export format');
      }
    } catch (error) {
      logger.error('Export report failed:', error);
      throw error;
    }
  }

  private groupByDay(events: any[], startDate: Date, endDate: Date) {
    const days = [];
    const eventsByDay = new Map<string, number>();

    // Initialize all days with 0
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      eventsByDay.set(key, 0);
    }

    // Count events by day
    for (const event of events) {
      const key = event.created_at.split('T')[0];
      eventsByDay.set(key, (eventsByDay.get(key) || 0) + 1);
    }

    return Array.from(eventsByDay.entries()).map(([date, count]) => ({
      date,
      count
    }));
  }

  private getTopEvents(events: any[]) {
    const eventCounts = new Map<string, number>();
    
    for (const event of events) {
      eventCounts.set(event.event, (eventCounts.get(event.event) || 0) + 1);
    }

    return Array.from(eventCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([event, count]) => ({ event, count }));
  }

  private getActiveUsers(events: any[]) {
    const userActivity = new Map<string, { count: number; lastActivity: string }>();
    
    for (const event of events) {
      if (event.user_id) {
        const existing = userActivity.get(event.user_id) || { count: 0, lastActivity: event.created_at };
        userActivity.set(event.user_id, {
          count: existing.count + 1,
          lastActivity: event.created_at > existing.lastActivity ? event.created_at : existing.lastActivity
        });
      }
    }

    return Array.from(userActivity.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .map(([userId, data]) => [
        userId,
        data.count,
        new Date(data.lastActivity).toLocaleDateString()
      ]);
  }

  private groupSecurityEventsByDay(events: any[], startDate: Date, endDate: Date) {
    const days = [];
    const eventsByDay = new Map<string, number>();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      eventsByDay.set(key, 0);
    }

    for (const event of events) {
      const key = event.created_at.split('T')[0];
      eventsByDay.set(key, (eventsByDay.get(key) || 0) + 1);
    }

    return Array.from(eventsByDay.entries()).map(([date, count]) => ({
      date,
      count
    }));
  }
}

export const reportService = new ReportService();