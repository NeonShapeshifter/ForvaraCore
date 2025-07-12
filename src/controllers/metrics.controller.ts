import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { metricsService } from '../services/metrics.service';
import { analyticsService } from '../services/analytics.service';
import { reportService } from '../services/report.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ValidationError } from '../types';

export const getOverviewMetrics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { period = '30d', compare = true } = req.query;

    const metrics = await metricsService.getOverviewMetrics(
      tenantId,
      period as string,
      compare === 'true'
    );

    res.json(createApiResponse(
      true,
      metrics,
      'Métricas generales obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getUsageMetrics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { resource, granularity = 'day', from, to } = req.query;

    const metrics = await metricsService.getUsageMetrics(tenantId, {
      resource: resource as string,
      granularity: granularity as string,
      from: from as string,
      to: to as string
    });

    res.json(createApiResponse(
      true,
      metrics,
      'Métricas de uso obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getPerformanceMetrics = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { metric, service, period = '24h' } = req.query;

    const metrics = await metricsService.getPerformanceMetrics({
      tenant_id: tenantId,
      metric: metric as string,
      service: service as string,
      period: period as string
    });

    res.json(createApiResponse(
      true,
      metrics,
      'Métricas de rendimiento obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getCostAnalysis = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { breakdown = 'app', period = 'current_month' } = req.query;

    const analysis = await analyticsService.getCostAnalysis(
      tenantId,
      breakdown as string,
      period as string
    );

    res.json(createApiResponse(
      true,
      analysis,
      'Análisis de costos obtenido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getTrends = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { metric, forecast_days = 30 } = req.query;

    if (!metric) {
      throw new ValidationError('Se requiere especificar la métrica');
    }

    const trends = await analyticsService.getTrendsAndPredictions(
      tenantId,
      metric as string,
      Number(forecast_days)
    );

    res.json(createApiResponse(
      true,
      trends,
      'Tendencias y predicciones obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getMetricAlerts = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { status, severity } = req.query;

    const alerts = await metricsService.getAlerts(tenantId, {
      status: status as string,
      severity: severity as string
    });

    res.json(createApiResponse(
      true,
      alerts,
      'Alertas obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const exportReport = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { type, period, format = 'pdf', email } = req.body;

    // Generar reporte
    const report = await reportService.generateReport({
      tenant_id: tenantId,
      type,
      period,
      format,
      requested_by: userId
    });

    // Si se especificó email, enviar por correo
    if (email) {
      await emailService.sendReportEmail({
        to: email,
        report_type: type,
        attachment: report.buffer,
        filename: report.filename
      });

      res.json(createApiResponse(
        true,
        {
          sent_to: email,
          filename: report.filename
        },
        'Reporte enviado por email'
      ));
    } else {
      // Descargar directamente
      res.setHeader('Content-Type', report.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${report.filename}"`
      );
      res.send(report.buffer);
    }
  } catch (error: any) {
    throw error;
  }
};

export const customQuery = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { query } = req.body;

    if (!query || !query.metrics || query.metrics.length === 0) {
      throw new ValidationError('Query inválida');
    }

    const results = await analyticsService.executeCustomQuery(
      tenantId,
      query
    );

    res.json(createApiResponse(
      true,
      results,
      'Consulta ejecutada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};
