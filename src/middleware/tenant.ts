import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/types';
import { forbidden } from '@/utils/responses';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export const requireTenant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return forbidden(res, 'Authentication required');
    }

    const tenantId = req.headers['x-tenant-id'] as string;
    
    if (!tenantId) {
      return forbidden(res, 'Tenant ID required');
    }

    // Verificar que el usuario pertenece al tenant (con fallback seguro)
    const { data: membership } = await safeSupabaseQuery(
      () => supabase
        .from('company_members')
        .select('*, companies(*)')
        .eq('user_id', req.user!.id)
        .eq('company_id', tenantId)
        .eq('status', 'active')
        .single(),
      { data: null, error: null }
    );

    if (!membership) {
      return forbidden(res, 'Access denied to this company');
    }

    // Adjuntar company al request
    req.company = (membership as any).companies;
    
    next();
  } catch (error) {
    console.error('❌ Tenant middleware error:', error);
    return forbidden(res, 'Tenant verification failed');
  }
};

export const optionalTenant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return next(); // No user, skip tenant check
    }

    const tenantId = req.headers['x-tenant-id'] as string;
    
    if (!tenantId) {
      return next(); // No tenant ID, continue
    }

    // Intentar cargar tenant (silenciosamente)
    const { data: membership } = await safeSupabaseQuery(
      () => supabase
        .from('company_members')
        .select('*, companies(*)')
        .eq('user_id', req.user!.id)
        .eq('company_id', tenantId)
        .eq('status', 'active')
        .single(),
      { data: null, error: null }
    );

    if (membership) {
      req.company = (membership as any).companies;
    }
    
    next();
  } catch (error) {
    // Error silencioso, continúa sin tenant
    next();
  }
};