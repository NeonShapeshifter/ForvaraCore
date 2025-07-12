import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedRequest } from '../types';

export const requestIdMiddleware = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  // Generar o usar ID existente
  const requestId = req.headers['x-request-id'] as string || 
                    `req_${Date.now()}_${uuidv4().substring(0, 8)}`;
  
  req.requestId = requestId;
  req.startTime = performance.now();
  
  // Añadir a headers de respuesta
  res.setHeader('X-Request-ID', requestId);
  
  next();
};

// Middleware para propagar request ID en servicios
export const propagateRequestId = (requestId: string) => {
  return {
    headers: {
      'X-Request-ID': requestId
    }
  };
};
