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
// This endpoint does NOT require a tenant header since it lists all companies
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
  const { 
    razon_social,
    ruc,
    phone,
    contact_email,
    address,
    industry_type,
    company_size,
    billing_email,
    billing_address,
    logo_url,
    description,
    // Legacy support
    name 
  } = req.body;
  
  try {
    const updateData: any = {};
    
    // Map fields that exist in request
    if (razon_social || name) updateData.razon_social = razon_social || name;
    if (ruc) updateData.ruc = ruc;
    if (phone) updateData.phone = phone;
    if (contact_email) updateData.contact_email = contact_email;
    if (address) updateData.address = address;
    if (industry_type) updateData.industry_type = industry_type;
    if (company_size) updateData.company_size = company_size;
    if (billing_email) updateData.billing_email = billing_email;
    if (billing_address) updateData.billing_address = billing_address;
    if (logo_url) updateData.logo_url = logo_url;
    if (description) updateData.description = description;
    
    const company = await tenantService.updateCompany(
      req.params.id, 
      req.user.id, 
      updateData
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

// POST /api/tenants/:id/invite - Invite user to company
router.post('/:id/invite', safeAsync(async (req: any, res: any) => {
  const { email, phone, role = 'member' } = req.body;
  
  try {
    const invitation = await tenantService.inviteUser({
      companyId: req.params.id,
      invitedBy: req.user.id,
      email,
      phone,
      role
    });
    return success(res, invitation, 201);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// PATCH /api/tenants/:id/members/:memberId/role - Change member role
router.patch('/:id/members/:memberId/role', safeAsync(async (req: any, res: any) => {
  const { role } = req.body;
  
  try {
    const member = await tenantService.changeMemberRole(
      req.params.id,
      req.params.memberId,
      req.user.id,
      role
    );
    return success(res, member);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// DELETE /api/tenants/:id/members/:memberId - Remove member
router.delete('/:id/members/:memberId', safeAsync(async (req: any, res: any) => {
  try {
    await tenantService.removeMember(
      req.params.id,
      req.params.memberId,
      req.user.id
    );
    return success(res, { message: 'Member removed successfully' });
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// GET /api/tenants/:id/invitations - Get pending invitations
router.get('/:id/invitations', safeAsync(async (req: any, res: any) => {
  try {
    const invitations = await tenantService.getPendingInvitations(req.params.id, req.user.id);
    return success(res, invitations);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

// POST /api/tenants/:id/invitations/:inviteId/accept - Accept invitation
router.post('/:id/invitations/:inviteId/accept', safeAsync(async (req: any, res: any) => {
  try {
    const membership = await tenantService.acceptInvitation(
      req.params.inviteId,
      req.user.id
    );
    return success(res, membership);
  } catch (err: any) {
    return error(res, err.message, 400);
  }
}));

export { router as tenantRoutes };