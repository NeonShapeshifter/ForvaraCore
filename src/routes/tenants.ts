import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { TenantService } from '@/services/tenant.service';

const router = Router();
const tenantService = new TenantService();

// Todos los endpoints requieren autenticación
router.use(authenticate);

// GET /api/tenants - Get user's companies
router.get('/', safeAsync(async (req: any, res: any) => {
  try {
    const companies = await tenantService.getUserCompanies(req.user.id);
    return success(res, companies);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/tenants - Create new company
router.post('/', safeAsync(async (req: any, res: any) => {
  const { name, description } = req.body;
  
  try {
    const company = await tenantService.createCompany({
      name,
      description,
      userId: req.user.id
    });
    return success(res, company, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/tenants/:id - Get specific company
router.get('/:id', safeAsync(async (req: any, res: any) => {
  try {
    const company = await tenantService.getCompany(req.params.id, req.user.id);
    return success(res, company);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PATCH /api/tenants/:id - Update company
router.patch('/:id', safeAsync(async (req: any, res: any) => {
  const { name, description, logo_url } = req.body;
  
  try {
    const company = await tenantService.updateCompany(
      req.params.id, 
      req.user.id, 
      { name, description, logo_url }
    );
    return success(res, company);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/tenants/:id/members - Get company members
router.get('/:id/members', safeAsync(async (req: any, res: any) => {
  try {
    const members = await tenantService.getMembers(req.params.id, req.user.id);
    return success(res, members);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as tenantRoutes };