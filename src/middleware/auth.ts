import { Response, NextFunction } from 'express';
import { AuthRequest } from '@/types';
import { unauthorized } from '@/utils/responses';
import { verifyToken, extractTokenFromHeader } from '@/utils/jwt';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return unauthorized(res, 'Token required');
    }

    const payload = verifyToken(token);
    if (!payload) {
      return unauthorized(res, 'Invalid token');
    }

    // Verificar que el usuario existe en Supabase (con fallback seguro)
    const { data: user } = await safeSupabaseQuery(
      supabase.from('users').select('*').eq('id', payload.userId).single(),
      { data: null, error: null }
    );

    if (!user) {
      return unauthorized(res, 'User not found');
    }

    // Adjuntar user al request
    req.user = user;
    
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    return unauthorized(res, 'Authentication failed');
  }
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return next(); // No token, pero continúa
    }

    const payload = verifyToken(token);
    if (!payload) {
      return next(); // Token inválido, pero continúa
    }

    // Intentar cargar usuario (silenciosamente)
    const { data: user } = await safeSupabaseQuery(
      supabase.from('users').select('*').eq('id', payload.userId).single(),
      { data: null, error: null }
    );

    if (user) {
      req.user = user;
    }
    
    next();
  } catch (error) {
    // Error silencioso, continúa sin auth
    next();
  }
};