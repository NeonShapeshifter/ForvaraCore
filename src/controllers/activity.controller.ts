import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';
import { ValidationError } from '../types';
import { Parser } from 'json2csv';
import PDFDocument from 'pdfkit';

export const getActivityLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const {
      page = 1,
      limit = 20,
      userId,
      action,
      resourceType,
      resourceId,
      from,
      to,
      success,
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    const result = await activityService.getActivityLogs({
      tenant_id: tenantId,
      page: Number(page),
      limit: Number(limit),
      filters: {
        user_id: userId as string,
        action: action as string,
        resource_type: resourceType as string,
        resource_id: resourceId as string,
        from: from as string,
        to: to as string,
        success: success === 'true' ? true : success === 'false' ? false : undefined
      },
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc'
    });

    res.json(createApiResponse(
      true,
      result.logs,
      'Logs de actividad obtenidos',
      undefined,
      undefined,
      {
        pagination: result.pagination
      }
    ));
  } catch (error: any) {
    throw error;
  }
};

export const exportActivityLogs = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const userId = req.userId!;
    const { format = 'csv', filters = {}, includeDetails = true } = req.body;

    // Obtener logs con los filtros
    const logs = await activityService.getActivityLogsForExport({
      tenant_id: tenantId,
      filters,
      includeDetails
    });

    // Log la exportación
    await activityService.log({
      user_id: userId,
      tenant_id: tenantId,
      action: 'ACTIVITY_LOGS_EXPORTED',
      details: {
        format,
        logs_count: logs.length,
        filters
      },
      ip_address: req.ip,
      user_agent: req.headers['user-agent'],
      success: true
    });

    switch (format) {
      case 'csv':
        await exportAsCSV(logs, res);
        break;
      
      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="activity-logs-${Date.now()}.json"`
        );
        res.json(logs);
        break;
      
      case 'pdf':
        await exportAsPDF(logs, res);
        break;
      
      default:
        throw new ValidationError('Formato no soportado');
    }
  } catch (error: any) {
    throw error;
  }
};

export const getActivityStats = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { period = '7d', groupBy = 'day' } = req.query;

    const stats = await activityService.getActivityStats(
      tenantId,
      period as string,
      groupBy as string
    );

    res.json(createApiResponse(
      true,
      stats,
      'Estadísticas de actividad obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getMyActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { page = 1, limit = 20 } = req.query;

    const result = await activityService.getUserActivity(userId, {
      page: Number(page),
      limit: Number(limit)
    });

    res.json(createApiResponse(
      true,
      result.logs,
      'Tu actividad obtenida',
      undefined,
      undefined,
      {
        pagination: result.pagination
      }
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getSuspiciousActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId!;
    const { severity } = req.query;

    const activities = await activityService.getSuspiciousActivities(
      tenantId,
      severity as string
    );

    res.json(createApiResponse(
      true,
      activities,
      'Actividades sospechosas detectadas'
    ));
  } catch (error: any) {
    throw error;
  }
};

// Helpers para exportación
async function exportAsCSV(logs: any[], res: Response): Promise<void> {
  const fields = [
    'created_at',
    'user_name',
    'action',
    'resource_type',
    'resource_id',
    'success',
    'ip_address',
    'user_agent'
  ];

  const parser = new Parser({ fields });
  const csv = parser.parse(logs);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="activity-logs-${Date.now()}.csv"`
  );
  res.send(csv);
}

async function exportAsPDF(logs: any[], res: Response): Promise<void> {
  const doc = new PDFDocument();
  
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="activity-logs-${Date.now()}.pdf"`
  );

  doc.pipe(res);

  // Header
  doc.fontSize(20).text('Activity Logs Report', 50, 50);
  doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, 50, 80);
  
  // Content
  let y = 120;
  logs.forEach((log, index) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    doc.fontSize(8);
    doc.text(`${log.created_at} - ${log.user_name}: ${log.action}`, 50, y);
    y += 15;
  });

  doc.end();
}
