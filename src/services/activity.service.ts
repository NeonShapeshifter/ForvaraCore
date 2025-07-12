import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { 
  ActivityLog,
  ActivityMetrics,
  PaginatedResponse,
  ActivityReport
} from '../types';
import { websocketService } from './websocket.service';
import { SOCKET_EVENTS } from '../constants';

let supabase: any = null;
let redis: any = null;

function ensureRedis() {
  if (!redis) {
    redis = getRedis();
  }
  return redis;
}

function ensureSupabase() {
  if (!supabase) {
    supabase = getSupabase();
  }
  return supabase;
}

class ActivityService {
  /**
   * Registrar actividad
   */
  async log(activity: Omit<ActivityLog, 'id' | 'created_at'>): Promise<ActivityLog> {
    try {
      const activityId = uuidv4();

      // Guardar en base de datos
      const { data: logged, error } = await supabase
        .from('activity_logs')
        .insert({
          id: activityId,
          ...activity,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      // Actualizar métricas en tiempo real
      await this.updateRealtimeMetrics(activity);

      // Si es una actividad importante, notificar en tiempo real
      if (this.isImportantActivity(activity.action)) {
        if (activity.tenant_id) {
          websocketService.sendToTenant(
            activity.tenant_id,
            SOCKET_EVENTS.ACTIVITY_UPDATE,
            logged
          );
        }
      }

      logger.debug({ 
        activityId, 
        action: activity.action,
        userId: activity.user_id 
      }, 'Activity logged');

      return logged;
    } catch (error) {
      logger.error({ error, activity }, 'Log activity failed');
      // No lanzar error para no interrumpir el flujo principal
      return {
        id: uuidv4(),
        ...activity,
        created_at: new Date().toISOString()
      } as ActivityLog;
    }
  }

  /**
   * Obtener logs de actividad
   */
  async getActivityLogs(params: {
    tenantId?: string;
    userId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    success?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<ActivityLog>> {
    try {
      const { 
        tenantId,
        userId,
        action,
        resourceType,
        resourceId,
        success,
        dateFrom,
        dateTo,
        page = 1, 
        limit = 50 
      } = params;

      let query = supabase
        .from('activity_logs')
        .select(`
          *,
          user:users!user_id (
            id,
            nombre,
            apellido,
            avatar_url
          )
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Filtros
      if (tenantId) {
        query = query.eq('tenant_id', tenantId);
      }

      if (userId) {
        query = query.eq('user_id', userId);
      }

      if (action) {
        query = query.eq('action', action);
      }

      if (resourceType) {
        query = query.eq('resource_type', resourceType);
      }

      if (resourceId) {
        query = query.eq('resource_id', resourceId);
      }

      if (typeof success === 'boolean') {
        query = query.eq('success', success);
      }

      if (dateFrom) {
        query = query.gte('created_at', dateFrom.toISOString());
      }

      if (dateTo) {
        query = query.lte('created_at', dateTo.toISOString());
      }

      // Paginación
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        data: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, params }, 'Get activity logs failed');
      throw error;
    }
  }

  /**
   * Obtener métricas de actividad
   */
  async getActivityMetrics(params: {
    tenantId?: string;
    userId?: string;
    period: 'hour' | 'day' | 'week' | 'month';
    dateFrom?: Date;
    dateTo?: Date;
  }): Promise<ActivityMetrics> {
    try {
      const { tenantId, userId, period, dateFrom, dateTo } = params;

      // Intentar obtener de cache
      const cacheKey = `metrics:${period}:${tenantId || 'global'}:${userId || 'all'}`;
      const cached = await ensureRedis().get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Calcular rango de fechas
      const endDate = dateTo || new Date();
      const startDate = dateFrom || this.getStartDateForPeriod(period, endDate);

      // Consultas paralelas para diferentes métricas
      const [
        totalActivities,
        activeUsers,
        topActions,
        activityByHour,
        errorRate
      ] = await Promise.all([
        this.getTotalActivities(tenantId, userId, startDate, endDate),
        this.getActiveUsers(tenantId, startDate, endDate),
        this.getTopActions(tenantId, userId, startDate, endDate),
        this.getActivityByHour(tenantId, userId, startDate, endDate),
        this.getErrorRate(tenantId, userId, startDate, endDate)
      ]);

      const metrics: ActivityMetrics = {
        period,
        startDate,
        endDate,
        totalActivities,
        activeUsers,
        topActions,
        activityByHour,
        errorRate,
        trends: await this.calculateTrends(tenantId, userId, period)
      };

      // Cachear por 5 minutos
      await ensureRedis().setex(cacheKey, 300, JSON.stringify(metrics));

      return metrics;
    } catch (error) {
      logger.error({ error, params }, 'Get activity metrics failed');
      throw error;
    }
  }

  /**
   * Generar reporte de actividad
   */
  async generateActivityReport(params: {
    tenantId: string;
    period: 'daily' | 'weekly' | 'monthly';
    format?: 'json' | 'csv' | 'pdf';
  }): Promise<ActivityReport> {
    try {
      const { tenantId, period, format = 'json' } = params;

      const endDate = new Date();
      const startDate = this.getReportStartDate(period, endDate);

      // Obtener datos para el reporte
      const [
        summary,
        userActivity,
        resourceActivity,
        peakHours,
        anomalies
      ] = await Promise.all([
        this.getActivitySummary(tenantId, startDate, endDate),
        this.getUserActivityReport(tenantId, startDate, endDate),
        this.getResourceActivityReport(tenantId, startDate, endDate),
        this.getPeakActivityHours(tenantId, startDate, endDate),
        this.detectAnomalies(tenantId, startDate, endDate)
      ]);

      const report: ActivityReport = {
        id: uuidv4(),
        tenant_id: tenantId,
        period,
        start_date: startDate,
        end_date: endDate,
        generated_at: new Date(),
        summary,
        user_activity: userActivity,
        resource_activity: resourceActivity,
        peak_hours: peakHours,
        anomalies,
        recommendations: this.generateRecommendations(summary, anomalies)
      };

      // Guardar reporte
      await supabase
        .from('activity_reports')
        .insert({
          ...report,
          format,
          data: report
        });

      logger.info({ 
        reportId: report.id,
        tenantId,
        period 
      }, 'Activity report generated');

      return report;
    } catch (error) {
      logger.error({ error, params }, 'Generate activity report failed');
      throw error;
    }
  }

  /**
   * Búsqueda avanzada en logs
   */
  async searchLogs(params: {
    query: string;
    tenantId?: string;
    filters?: {
      users?: string[];
      actions?: string[];
      resources?: string[];
      dateRange?: { from: Date; to: Date };
    };
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<ActivityLog>> {
    try {
      const { query, tenantId, filters, page = 1, limit = 50 } = params;

      let queryBuilder = supabase
        .from('activity_logs')
        .select('*', { count: 'exact' });

      // Búsqueda de texto
      if (query) {
        queryBuilder = queryBuilder.or(
          `details->>'message'.ilike.%${query}%,` +
          `details->>'description'.ilike.%${query}%,` +
          `resource_id.ilike.%${query}%`
        );
      }

      // Filtros
      if (tenantId) {
        queryBuilder = queryBuilder.eq('tenant_id', tenantId);
      }

      if (filters?.users?.length) {
        queryBuilder = queryBuilder.in('user_id', filters.users);
      }

      if (filters?.actions?.length) {
        queryBuilder = queryBuilder.in('action', filters.actions);
      }

      if (filters?.resources?.length) {
        queryBuilder = queryBuilder.in('resource_type', filters.resources);
      }

      if (filters?.dateRange) {
        queryBuilder = queryBuilder
          .gte('created_at', filters.dateRange.from.toISOString())
          .lte('created_at', filters.dateRange.to.toISOString());
      }

      // Paginación
      const offset = (page - 1) * limit;
      queryBuilder = queryBuilder
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await queryBuilder;

      if (error) throw error;

      return {
        data: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      };
    } catch (error) {
      logger.error({ error, params }, 'Search logs failed');
      throw error;
    }
  }

  /**
   * Exportar logs
   */
  async exportLogs(params: {
    tenantId: string;
    filters: any;
    format: 'csv' | 'json' | 'excel';
  }): Promise<string> {
    try {
      // Obtener logs sin límite
      const logs = await this.getAllLogsForExport(params.tenantId, params.filters);

      let exportData: string;
      let filename: string;

      switch (params.format) {
        case 'csv':
          exportData = this.convertToCSV(logs);
          filename = `activity_logs_${Date.now()}.csv`;
          break;
        
        case 'excel':
          exportData = await this.convertToExcel(logs);
          filename = `activity_logs_${Date.now()}.xlsx`;
          break;
        
        default:
          exportData = JSON.stringify(logs, null, 2);
          filename = `activity_logs_${Date.now()}.json`;
      }

      // Subir a storage temporal
      const { data: { publicUrl } } = await supabase
        .storage
        .from('exports')
        .upload(`activity/${filename}`, exportData, {
          contentType: this.getContentType(params.format),
          cacheControl: '3600'
        });

      // Generar URL temporal
      const { data: { signedUrl } } = await supabase
        .storage
        .from('exports')
        .createSignedUrl(`activity/${filename}`, 3600); // 1 hora

      logger.info({ 
        tenantId: params.tenantId,
        format: params.format,
        logCount: logs.length 
      }, 'Activity logs exported');

      return signedUrl;
    } catch (error) {
      logger.error({ error, params }, 'Export logs failed');
      throw error;
    }
  }

  /**
   * Limpiar logs antiguos
   */
  async cleanupOldLogs(retentionDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Archivar logs importantes antes de eliminar
      await this.archiveImportantLogs(cutoffDate);

      // Eliminar logs antiguos
      const { error, count } = await supabase
        .from('activity_logs')
        .delete()
        .lt('created_at', cutoffDate.toISOString())
        .not('action', 'in', '(USER_DELETED,SUBSCRIPTION_CANCELLED,SECURITY_BREACH)');

      if (error) throw error;

      logger.info({ 
        deletedCount: count,
        retentionDays 
      }, 'Old activity logs cleaned up');

      return count || 0;
    } catch (error) {
      logger.error({ error, retentionDays }, 'Cleanup old logs failed');
      throw error;
    }
  }

  // Métodos auxiliares privados
  private async updateRealtimeMetrics(activity: any): Promise<void> {
    const hour = new Date().getHours();
    const key = `metrics:realtime:${activity.tenant_id || 'global'}:${hour}`;
    
    await ensureRedis().hincrby(key, 'total', 1);
    await ensureRedis().hincrby(key, activity.action, 1);
    
    if (!activity.success) {
      await ensureRedis().hincrby(key, 'errors', 1);
    }
    
    // Expirar después de 2 horas
    await ensureRedis().expire(key, 7200);
  }

  private isImportantActivity(action: string): boolean {
    const importantActions = [
      'USER_CREATED',
      'USER_DELETED',
      'TENANT_CREATED',
      'SUBSCRIPTION_CREATED',
      'SUBSCRIPTION_CANCELLED',
      'SECURITY_BREACH',
      'PERMISSION_CHANGED',
      'BULK_OPERATION'
    ];
    
    return importantActions.includes(action);
  }

  private getStartDateForPeriod(period: string, endDate: Date): Date {
    const startDate = new Date(endDate);
    
    switch (period) {
      case 'hour':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }
    
    return startDate;
  }

  private getReportStartDate(period: string, endDate: Date): Date {
    const startDate = new Date(endDate);
    
    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
    }
    
    return startDate;
  }

  private async getTotalActivities(
    tenantId: string | undefined,
    userId: string | undefined,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    let query = supabase
      .from('activity_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (userId) query = query.eq('user_id', userId);

    const { count } = await query;
    return count || 0;
  }

  private async getActiveUsers(
    tenantId: string | undefined,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    let query = supabase
      .from('activity_logs')
      .select('user_id', { count: 'exact' })
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data } = await query;
    const uniqueUsers = new Set(data?.map(d => d.user_id));
    return uniqueUsers.size;
  }

  private async getTopActions(
    tenantId: string | undefined,
    userId: string | undefined,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ action: string; count: number }>> {
    // Usar SQL raw para agregación
    const query = tenantId 
      ? `tenant_id = '${tenantId}'` 
      : 'tenant_id IS NOT NULL';
    
    const userFilter = userId 
      ? ` AND user_id = '${userId}'` 
      : '';

    const { data, error } = await ensureSupabase().rpc('get_top_actions', {
      start_date: startDate.toISOString(),
      end_date: endDate.toISOString(),
      filter_query: query + userFilter
    });

    if (error) throw error;

    return data || [];
  }

  private async getActivityByHour(
    tenantId: string | undefined,
    userId: string | undefined,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ hour: number; count: number }>> {
    // Implementar agregación por hora
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 }));
    
    // Aquí implementarías la lógica real de agregación
    return hours;
  }

  private async getErrorRate(
    tenantId: string | undefined,
    userId: string | undefined,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    let query = supabase
      .from('activity_logs')
      .select('success', { count: 'exact' })
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (tenantId) query = query.eq('tenant_id', tenantId);
    if (userId) query = query.eq('user_id', userId);

    const { data } = await query;
    
    if (!data || data.length === 0) return 0;
    
    const errors = data.filter(d => !d.success).length;
    return (errors / data.length) * 100;
  }

  private async calculateTrends(
    tenantId: string | undefined,
    userId: string | undefined,
    period: string
  ): Promise<any> {
    // Implementar cálculo de tendencias comparando período actual vs anterior
    return {
      activity_change: 0,
      user_change: 0,
      error_rate_change: 0
    };
  }

  private async getActivitySummary(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any> {
    // Implementar resumen de actividad
    return {
      total_activities: 0,
      unique_users: 0,
      most_active_user: null,
      peak_hour: null
    };
  }

  private async getUserActivityReport(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Implementar reporte de actividad por usuario
    return [];
  }

  private async getResourceActivityReport(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Implementar reporte de actividad por recurso
    return [];
  }

  private async getPeakActivityHours(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Implementar detección de horas pico
    return [];
  }

  private async detectAnomalies(
    tenantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    // Implementar detección de anomalías
    return [];
  }

  private generateRecommendations(summary: any, anomalies: any[]): string[] {
    const recommendations: string[] = [];
    
    // Generar recomendaciones basadas en los datos
    if (summary.error_rate > 5) {
      recommendations.push('Alta tasa de errores detectada. Revisar logs de errores.');
    }
    
    if (anomalies.length > 0) {
      recommendations.push('Se detectaron anomalías en la actividad. Investigar posibles problemas.');
    }
    
    return recommendations;
  }

  private async archiveImportantLogs(cutoffDate: Date): Promise<void> {
    // Implementar archivado de logs importantes
    const importantLogs = await supabase
      .from('activity_logs')
      .select('*')
      .lt('created_at', cutoffDate.toISOString())
      .in('action', ['USER_DELETED', 'SUBSCRIPTION_CANCELLED', 'SECURITY_BREACH']);

    if (importantLogs.data && importantLogs.data.length > 0) {
      await supabase
        .from('activity_logs_archive')
        .insert(importantLogs.data);
    }
  }

  private async getAllLogsForExport(tenantId: string, filters: any): Promise<any[]> {
    // Implementar obtención de todos los logs para exportar
    return [];
  }

  private convertToCSV(logs: any[]): string {
    // Implementar conversión a CSV
    return '';
  }

  private async convertToExcel(logs: any[]): Promise<string> {
    // Implementar conversión a Excel
    return '';
  }

  private getContentType(format: string): string {
    const contentTypes = {
      csv: 'text/csv',
      json: 'application/json',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
    
    return contentTypes[format as keyof typeof contentTypes] || 'application/octet-stream';
  }
}

export const activityService = new ActivityService();

// Export alias for logActivity
export const logActivity = activityService.log.bind(activityService);
