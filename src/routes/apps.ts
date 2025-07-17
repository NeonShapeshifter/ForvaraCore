import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { requireTenant, optionalTenant, individualOrCompanyMode } from '@/middleware/tenant';
import { AppService } from '@/services/app.service';

const router = Router();
const appService = new AppService();

// GET /api/apps - Get all available apps (public)
router.get('/', optionalTenant, safeAsync(async (req: any, res: any) => {
  try {
    const apps = await appService.getApps();
    return success(res, apps);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/apps/installed - Get installed apps (individual or company mode)
router.get('/installed', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    if (req.user.is_individual_mode) {
      // Individual mode: get personal apps
      const apps = await appService.getPersonalApps(req.user.id);
      return success(res, apps);
    } else {
      // Company mode: get company apps
      const apps = await appService.getInstalledApps(req.company.id);
      return success(res, apps);
    }
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/apps/:id - Get specific app
router.get('/:id', safeAsync(async (req: any, res: any) => {
  try {
    const app = await appService.getApp(req.params.id);
    return success(res, app);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/apps/:id/install - Install app (individual or company mode)
router.post('/:id/install', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  const { planId } = req.body;
  
  try {
    if (req.user.is_individual_mode) {
      // Individual mode: install for personal use
      const result = await appService.installPersonalApp(
        req.params.id, 
        req.user.id, 
        planId || 'basic'
      );
      return success(res, result, 201);
    } else {
      // Company mode: install for company
      const result = await appService.installApp(
        req.params.id, 
        req.company.id, 
        planId || 'basic'
      );
      return success(res, result, 201);
    }
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/apps/:id/uninstall - Uninstall app (individual or company mode)
router.post('/:id/uninstall', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    if (req.user.is_individual_mode) {
      // Individual mode: uninstall personal app
      const result = await appService.uninstallPersonalApp(req.params.id, req.user.id);
      return success(res, result);
    } else {
      // Company mode: uninstall company app
      const result = await appService.uninstallApp(req.params.id, req.company.id);
      return success(res, result);
    }
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/apps/:id/launch - Launch app (individual or company mode)
router.post('/:id/launch', authenticate, individualOrCompanyMode, safeAsync(async (req: any, res: any) => {
  try {
    const app = await appService.getApp(req.params.id);
    
    if (req.user.is_individual_mode) {
      // Individual mode: launch with user context
      return success(res, {
        url: `https://${app.name}.forvara.com?token=placeholder&user=${req.user.id}`,
        message: 'App launched successfully (individual mode)'
      });
    } else {
      // Company mode: launch with company context
      return success(res, {
        url: `https://${app.name}.forvara.com?token=placeholder&tenant=${req.company.id}`,
        message: 'App launched successfully (company mode)'
      });
    }
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as appRoutes };