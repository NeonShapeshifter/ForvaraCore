import { Response } from 'express';
import { errorResponse } from './responses.js';

// Wrapper para funciones async que previene crashes
export const safeAsync = (fn: Function) => {
  return async (req: any, res: Response, next: any) => {
    try {
      await fn(req, res, next);
    } catch (error: any) {
      console.error('❌ Safe async error:', error);
      
      // Si ya se envió response, no hacer nada
      if (res.headersSent) {
        return;
      }
      
      // Error personalizado vs error genérico
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          error: {
            message: error.message,
            code: error.code || 'ERROR'
          }
        });
      }
      
      // Error genérico - NO CRASHEAR NUNCA
      return res.status(500).json(errorResponse('Something went wrong, but we\'re still alive! 🚀'));
    }
  };
};

// Wrapper para Supabase queries que nunca fallan
export const safeSupabaseQuery = async <T>(
  queryBuilder: any,
  fallback: { data: T | null; error: any }
): Promise<{ data: T | null; error: any }> => {
  try {
    const result = await queryBuilder;
    return result || fallback;
  } catch (error) {
    console.error('❌ Supabase query error:', error);
    return fallback;
  }
};