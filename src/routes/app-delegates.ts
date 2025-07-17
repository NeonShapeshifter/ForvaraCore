import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { requireTenant } from '@/middleware/tenant';
import { AppDelegatesService } from '@/services/app-delegates.service';

const router = Router();
const delegatesService = new AppDelegatesService();

// All endpoints require authentication and tenant context
router.use(authenticate);
router.use(requireTenant);

// =====================================================
// SIMPLE APP DELEGATES API
// Owner makes someone delegate within specific app
// =====================================================

// POST /api/app-delegates/:appId/grant - Grant delegate status
router.post('/:appId/grant', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return error(res, 'userId is required', 400);
    }
    
    const delegate = await delegatesService.grantDelegate({
      appId,
      userId,
      companyId: req.company.id,
      grantedBy: req.user.id
    });
    
    return success(res, delegate, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/app-delegates/:appId/revoke - Revoke delegate status
router.post('/:appId/revoke', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    const { userId } = req.body;
    
    if (!userId) {
      return error(res, 'userId is required', 400);
    }
    
    await delegatesService.revokeDelegate({
      appId,
      userId,
      companyId: req.company.id,
      revokedBy: req.user.id
    });
    
    return success(res, { message: 'Delegate status revoked successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/app-delegates/:appId/list - List delegates for app
router.get('/:appId/list', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;
    
    const delegates = await delegatesService.listDelegates({
      appId,
      companyId: req.company.id,
      requestedBy: req.user.id
    });
    
    return success(res, delegates);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/app-delegates/:appId/check/:userId - Check if user is delegate
router.get('/:appId/check/:userId', safeAsync(async (req: any, res: any) => {
  try {
    const { appId, userId } = req.params;
    
    const isDelegate = await delegatesService.isDelegate({
      appId,
      userId,
      companyId: req.company.id
    });
    
    return success(res, { is_delegate: isDelegate });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/app-delegates/user/apps - Get apps where current user is delegate
router.get('/user/apps', safeAsync(async (req: any, res: any) => {
  try {
    const delegateApps = await delegatesService.getUserDelegateApps({
      userId: req.user.id,
      companyId: req.company.id
    });
    
    return success(res, delegateApps);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as appDelegatesRoutes };