import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { requireTenant, optionalTenant } from '@/middleware/tenant';
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

// GET /api/apps/installed - Get installed apps (requires auth + tenant)
router.get('/installed', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const apps = await appService.getInstalledApps(req.company.id);
    return success(res, apps);
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

// POST /api/apps/:id/install - Install app (requires auth + tenant)
router.post('/:id/install', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  const { planId } = req.body;
  
  try {
    const result = await appService.installApp(
      req.params.id, 
      req.company.id, 
      planId || 'basic'
    );
    return success(res, result, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/apps/:id/uninstall - Uninstall app (requires auth + tenant)
router.post('/:id/uninstall', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const result = await appService.uninstallApp(req.params.id, req.company.id);
    return success(res, result);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/apps/:id/launch - Launch app (placeholder)
router.post('/:id/launch', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const app = await appService.getApp(req.params.id);
    
    // Placeholder - in the future this would generate a signed URL or redirect
    return success(res, {
      url: `https://${app.name}.forvara.com?token=placeholder&tenant=${req.company.id}`,
      message: 'App launched successfully'
    });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as appRoutes };