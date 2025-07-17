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
      // No tenant ID - this is fine for individual mode
      req.user!.company_id = null;
      return next();
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
      req.user!.company_id = tenantId;
    } else {
      // User doesn't belong to this company
      req.user!.company_id = null;
    }
    
    next();
  } catch (error) {
    // Error silencioso, continúa sin tenant
    req.user!.company_id = null;
    next();
  }
};

// New middleware: Support both individual and company modes
export const individualOrCompanyMode = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.status(403).json(errorResponse('Authentication required'));
    }

    const tenantId = req.headers['x-tenant-id'] as string;
    
    // Individual mode - no tenant required
    if (!tenantId) {
      req.user!.company_id = null;
      req.user!.is_individual_mode = true;
      return next();
    }

    // Company mode - verify membership
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

    // Set company context
    req.company = (membership as any).companies;
    req.user!.company_id = tenantId;
    req.user!.is_individual_mode = false;
    
    next();
  } catch (error) {
    console.error('❌ Individual/Company mode error:', error);
    return res.status(500).json(errorResponse('Mode verification failed'));
  }
};