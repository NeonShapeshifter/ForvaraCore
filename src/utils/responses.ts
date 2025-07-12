import { Response } from 'express';
import { ApiResponse } from '@/types';

export const success = <T>(res: Response, data: T, status = 200): Response => {
  const response: ApiResponse<T> = { data };
  return res.status(status).json(response);
};

export const error = (res: Response, message: string, status = 400, code?: string): Response => {
  const response: ApiResponse = {
    error: { message, code }
  };
  return res.status(status).json(response);
};

export const notFound = (res: Response, resource = 'Resource'): Response => {
  return error(res, `${resource} not found`, 404, 'NOT_FOUND');
};

export const unauthorized = (res: Response, message = 'Unauthorized'): Response => {
  return error(res, message, 401, 'UNAUTHORIZED');
};

export const forbidden = (res: Response, message = 'Forbidden'): Response => {
  return error(res, message, 403, 'FORBIDDEN');
};

export const conflict = (res: Response, message: string): Response => {
  return error(res, message, 409, 'CONFLICT');
};

export const serverError = (res: Response, message = 'Internal server error'): Response => {
  return error(res, message, 500, 'SERVER_ERROR');
};
