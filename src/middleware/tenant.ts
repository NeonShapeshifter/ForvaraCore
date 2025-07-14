import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/index.js';
import { errorResponse } from '../utils/responses.js';
import { supabase } from '../config/database.js';
import { safeSupabaseQuery } from '../utils/safeAsync.js';

export const requireTenant = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(403).json(errorResponse('Authentication required'));
    }

    const tenantId = req.headers['x-tenant-id'] as string;
    
    if (!tenantId) {
      return res.status(403).json(errorResponse('Tenant ID required'));
    }

    // Verificar que el usuario pertenece al tenant (con fallback seguro)
    const { data: membership } = await safeSupabaseQuery(
      supabase
        .from('company_members')
        .select('*, companies(*)')
        .eq('user_id', req.user!.id)
        .eq('company_id', tenantId)
        .eq('status', 'active')
        .single(),
      { data: null, error: null }
    );

    if (!membership) {
      return res.status(403).json(errorResponse('Access denied to this company'));
    }

    // Adjuntar company al request y company_id al user
    req.company = (membership as any).companies;
    req.user!.company_id = tenantId;
    
    next();
  } catch (error) {
    console.error('❌ Tenant middleware error:', error);
    return res.status(403).json(errorResponse('Tenant verification failed'));
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
      supabase
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