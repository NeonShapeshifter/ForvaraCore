import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { requireTenant } from '@/middleware/tenant';
import { HubService } from '@/services/hub.service';

const router = Router();
const hubService = new HubService();

// GET /api/hub/dashboard - Get dashboard data
router.get('/dashboard', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const dashboardData = await hubService.getDashboardData(req.company.id, req.user.id);
    return success(res, dashboardData);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/hub/quick-actions - Get quick actions for current user
router.get('/quick-actions', authenticate, requireTenant, safeAsync(async (req: any, res: any) => {
  try {
    const quickActions = await hubService.getQuickActions(req.company.id, req.user.id);
    return success(res, quickActions);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as hubRoutes };