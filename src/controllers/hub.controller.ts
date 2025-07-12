import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { hubService } from '../services/hub.service';
import { userService } from '../services/user.service';
import { subscriptionService } from '../services/subscription.service';
import { notificationService } from '../services/notification.service';
import { activityService } from '../services/activity.service';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';

export const getDashboard = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const user = req.user!;

    // Obtener datos en paralelo
    const [
      tenants,
      notifications,
      recentActivity,
      quickStats
    ] = await Promise.all([
      userService.getUserTenants(userId),
      notificationService.getRecentNotifications(userId, 5),
      activityService.getUserRecentActivity(userId, 10),
      hubService.getUserQuickStats(userId)
    ]);

    // Para cada tenant, obtener apps disponibles
    const tenantsWithApps = await Promise.all(
      tenants.map(async (ut) => {
        const apps = await hubService.getTenantApps(ut.tenant.id);
        return {
          id: ut.tenant.id,
          nombre: ut.tenant.nombre,
          logo_url: ut.tenant.logo_url,
          rol: ut.rol,
          apps: apps.map(app => ({
            id: app.id,
            name: app.name,
            icon: app.icon_url,
            hasAccess: app.hasAccess,
            subscriptionStatus: app.subscriptionStatus
          }))
        };
      })
    );

    const dashboardData = {
      user: {
        id: user.id,
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        forvara_mail: user.forvara_mail,
        avatar_url: user.avatar_url,
        settings: user.settings
      },
      tenants: tenantsWithApps,
      notifications: {
        unreadCount: notifications.unreadCount,
        recent: notifications.items
      },
      recentActivity,
      quickStats,
      currentTenant: req.tenantId ? 
        tenantsWithApps.find(t => t.id === req.tenantId) : null
    };

    res.json(createApiResponse(
      true,
      dashboardData,
      'Dashboard cargado exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getApps = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const tenantId = req.tenantId;
    const { category = 'all' } = req.query;

    let apps;
    if (tenantId) {
      apps = await hubService.getTenantApps(tenantId, category as string);
    } else {
      apps = await hubService.getAllApps(category as string);
    }

    res.json(createApiResponse(
      true,
      apps,
      'Aplicaciones obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getQuickActions = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const tenantId = req.tenantId;

    const actions = await hubService.getUserQuickActions(userId, tenantId);

    res.json(createApiResponse(
      true,
      actions,
      'Acciones rápidas obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getRecentActivity = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { limit = 10 } = req.query;

    const activity = await activityService.getUserRecentActivity(
      userId,
      Number(limit)
    );

    res.json(createApiResponse(
      true,
      activity,
      'Actividad reciente obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAnnouncements = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const announcements = await hubService.getActiveAnnouncements();

    res.json(createApiResponse(
      true,
      announcements,
      'Anuncios obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const globalSearch = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const tenantId = req.tenantId;
    const { q, type, limit = 20 } = req.query;

    if (!q || (q as string).length < 2) {
      res.json(createApiResponse(
        true,
        [],
        'Ingresa al menos 2 caracteres'
      ));
      return;
    }

    const results = await hubService.globalSearch({
      query: q as string,
      types: type as string[],
      userId,
      tenantId,
      limit: Number(limit)
    });

    res.json(createApiResponse(
      true,
      results,
      `${results.total} resultados encontrados`
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getOnboardingStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const tenantId = req.tenantId!;

    const status = await hubService.getOnboardingStatus(userId, tenantId);

    res.json(createApiResponse(
      true,
      status,
      'Estado de onboarding obtenido'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const completeOnboardingStep = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.userId!;
    const { step } = req.body;

    await hubService.completeOnboardingStep(userId, step);

    res.json(createApiResponse(
      true,
      null,
      'Paso completado'
    ));
  } catch (error: any) {
    throw error;
  }
};
