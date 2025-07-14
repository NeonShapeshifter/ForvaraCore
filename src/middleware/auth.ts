import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types/index.js';
import { errorResponse } from '../utils/responses.js';
import { verifyToken, extractTokenFromHeader } from '../utils/jwt.js';
import { supabase } from '../config/database.js';
import { safeSupabaseQuery } from '../utils/safeAsync.js';

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json(errorResponse('Token required'));
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json(errorResponse('Invalid token'));
    }

    // Verificar que el usuario existe en Supabase (con fallback seguro)
    const { data: user } = await safeSupabaseQuery(
      supabase.from('users').select('*').eq('id', payload.userId).single(),
      { data: null, error: null }
    );

    if (!user) {
      return res.status(401).json(errorResponse('User not found'));
    }

    // Adjuntar user al request
    req.user = user;
    
    next();
  } catch (error) {
    console.error('❌ Auth middleware error:', error);
    return res.status(401).json(errorResponse('Authentication failed'));
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

// Admin authentication middleware
export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // First authenticate the user
    const token = extractTokenFromHeader(req.headers.authorization);
    
    if (!token) {
      return res.status(401).json(errorResponse('Token required'));
    }

    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json(errorResponse('Invalid token'));
    }

    // Get user
    const { data: user } = await safeSupabaseQuery(
      supabase.from('users').select('*').eq('id', payload.userId).single(),
      { data: null, error: null }
    );

    if (!user) {
      return res.status(401).json(errorResponse('User not found'));
    }

    // Check if user is admin (define admin by email or add admin flag to users table)
    const adminEmails = [
      'ale@forvara.com',
      'admin@forvara.com',
      // Add your admin emails here
    ];

    if (!adminEmails.includes(user.email)) {
      return res.status(403).json(errorResponse('Admin access required'));
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Admin auth error:', error);
    return res.status(500).json(errorResponse('Authentication failed'));
  }
};