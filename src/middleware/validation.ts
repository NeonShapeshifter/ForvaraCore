import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ErrorCode } from '../constants/errors';
import { createApiResponse } from '../utils/responses';
import { logger } from '../config/logger';

interface ValidationOptions {
  stripUnknown?: boolean;
  abortEarly?: boolean;
}

const formatZodErrors = (error: ZodError): any[] => {
  return error.errors.map(err => ({
    field: err.path.join('.'),
    message: err.message,
    code: err.code,
    ...(err.code === 'invalid_type' && {
      expected: err.expected,
      received: err.received
    })
  }));
};

export const validateBody = (
  schema: ZodSchema,
  options: ValidationOptions = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body);
      
      if (options.stripUnknown) {
        req.body = validated;
      }
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatZodErrors(error);
        
        logger.warn({ 
          errors: formattedErrors,
          body: req.body,
          path: req.path,
          requestId: (req as any).requestId
        }, 'Validation error');
        
        res.status(400).json(createApiResponse(
          false,
          null,
          'Datos inválidos',
          'Errores de validación en el cuerpo de la petición',
          ErrorCode.VALIDATION_ERROR,
          { errors: formattedErrors }
        ));
        return;
      }
      
      next(error);
    }
  };
};

export const validateQuery = (
  schema: ZodSchema,
  options: ValidationOptions = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.query);
      
      if (options.stripUnknown) {
        req.query = validated;
      }
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatZodErrors(error);
        
        logger.warn({ 
          errors: formattedErrors,
          query: req.query,
          path: req.path,
          requestId: (req as any).requestId
        }, 'Query validation error');
        
        res.status(400).json(createApiResponse(
          false,
          null,
          'Parámetros inválidos',
          'Errores de validación en los parámetros de consulta',
          ErrorCode.VALIDATION_ERROR,
          { errors: formattedErrors }
        ));
        return;
      }
      
      next(error);
    }
  };
};

export const validateParams = (
  schema: ZodSchema,
  options: ValidationOptions = {}
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.params);
      
      if (options.stripUnknown) {
        req.params = validated;
      }
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = formatZodErrors(error);
        
        logger.warn({ 
          errors: formattedErrors,
          params: req.params,
          path: req.path,
          requestId: (req as any).requestId
        }, 'Params validation error');
        
        res.status(400).json(createApiResponse(
          false,
          null,
          'Parámetros de ruta inválidos',
          'Errores de validación en los parámetros de ruta',
          ErrorCode.VALIDATION_ERROR,
          { errors: formattedErrors }
        ));
        return;
      }
      
      next(error);
    }
  };
};

// Middleware combinado para validar body, query y params
export const validate = (schemas: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}, options: ValidationOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors: any[] = [];
      
      // Validar body
      if (schemas.body) {
        try {
          const validated = schemas.body.parse(req.body);
          if (options.stripUnknown) {
            req.body = validated;
          }
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...formatZodErrors(error).map(e => ({ ...e, source: 'body' })));
          }
        }
      }
      
      // Validar query
      if (schemas.query) {
        try {
          const validated = schemas.query.parse(req.query);
          if (options.stripUnknown) {
            req.query = validated;
          }
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...formatZodErrors(error).map(e => ({ ...e, source: 'query' })));
          }
        }
      }
      
      // Validar params
      if (schemas.params) {
        try {
          const validated = schemas.params.parse(req.params);
          if (options.stripUnknown) {
            req.params = validated;
          }
        } catch (error) {
          if (error instanceof ZodError) {
            errors.push(...formatZodErrors(error).map(e => ({ ...e, source: 'params' })));
          }
        }
      }
      
      // Si hay errores, responder con todos
      if (errors.length > 0 && !options.abortEarly) {
        logger.warn({ 
          errors,
          path: req.path,
          requestId: (req as any).requestId
        }, 'Multiple validation errors');
        
        res.status(400).json(createApiResponse(
          false,
          null,
          'Múltiples errores de validación',
          'Se encontraron errores en varios campos',
          ErrorCode.VALIDATION_ERROR,
          { errors }
        ));
        return;
      }
      
      next();
    } catch (error) {
      next(error);
    }
  };
};

// Validadores comunes reutilizables
export const commonValidators = {
  uuid: z.string().uuid('ID inválido'),
  
  email: z.string().email('Email inválido'),
  
  phone: z.string().regex(
    /^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{4,6}$/,
    'Formato de teléfono inválido'
  ),
  
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).optional().default('desc')
  }),
  
  dateRange: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  }).refine(
    data => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    { message: 'La fecha de inicio debe ser anterior a la fecha de fin' }
  )
};
