import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { appService } from '../services/app.service';
import { createApiResponse } from '../utils/responses';
import { NotFoundError } from '../types';

export const getAllApps = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { category, active } = req.query;

    const apps = await appService.getAllApps({
      category: category as string,
      activeOnly: active === 'true'
    });

    res.json(createApiResponse(
      true,
      apps,
      'Aplicaciones obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAppById = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { appId } = req.params;

    const app = await appService.getAppById(appId);
    
    if (!app) {
      throw new NotFoundError('Aplicación');
    }

    res.json(createApiResponse(
      true,
      app,
      'Aplicación obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAppPlans = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { appId } = req.params;

    const plans = await appService.getAppPlans(appId);

    res.json(createApiResponse(
      true,
      plans,
      'Planes obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAppAddons = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const { appId } = req.params;

    const addons = await appService.getAppAddons(appId);

    res.json(createApiResponse(
      true,
      addons,
      'Addons obtenidos'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const installApp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const { planId, config } = req.body;
    const { tenantId } = req.tenant;
    const userId = req.user.id;

    // Verificar que la app existe
    const app = await appService.getAppById(appId);
    if (!app) {
      return res.status(404).json({ error: { message: 'App not found' } });
    }

    // Crear suscripción básica para la app
    const installation = {
      id: `installation_${Date.now()}`,
      app_id: appId,
      tenant_id: tenantId,
      plan_id: planId || 'basic',
      status: 'active',
      config: config || {},
      installed_by: userId,
      installed_at: new Date().toISOString()
    };

    res.json(createApiResponse(
      true,
      installation,
      'App instalada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const uninstallApp = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const { reason, keepData } = req.body;
    const { tenantId } = req.tenant;
    const userId = req.user.id;

    // Simular desinstalación
    const uninstallResult = {
      app_id: appId,
      tenant_id: tenantId,
      uninstalled_by: userId,
      uninstalled_at: new Date().toISOString(),
      reason: reason || 'No reason provided',
      data_retained: keepData || false
    };

    res.json(createApiResponse(
      true,
      uninstallResult,
      'App desinstalada exitosamente'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getInstalledApps = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { tenantId } = req.tenant;
    
    // Mock data de apps instaladas
    const installedApps = [
      {
        id: 'hub',
        name: 'Forvara Hub',
        status: 'active',
        plan: 'free',
        installed_at: '2024-01-01T00:00:00Z',
        last_used: new Date().toISOString()
      },
      {
        id: 'mail',
        name: 'Forvara Mail',
        status: 'active', 
        plan: 'basic',
        installed_at: '2024-01-15T00:00:00Z',
        last_used: new Date().toISOString()
      }
    ];

    res.json(createApiResponse(
      true,
      installedApps,
      'Apps instaladas obtenidas'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const getAppConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const { tenantId } = req.tenant;

    // Mock configuration data
    const config = {
      app_id: appId,
      tenant_id: tenantId,
      settings: {
        theme: 'default',
        notifications_enabled: true,
        auto_updates: true,
        language: 'es'
      },
      updated_at: new Date().toISOString()
    };

    res.json(createApiResponse(
      true,
      config,
      'Configuración obtenida'
    ));
  } catch (error: any) {
    throw error;
  }
};

export const updateAppConfig = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { appId } = req.params;
    const { tenantId } = req.tenant;
    const newConfig = req.body;

    // Mock update
    const updatedConfig = {
      app_id: appId,
      tenant_id: tenantId,
      settings: {
        ...newConfig
      },
      updated_at: new Date().toISOString()
    };

    res.json(createApiResponse(
      true,
      updatedConfig,
      'Configuración actualizada'
    ));
  } catch (error: any) {
    throw error;
  }
};
