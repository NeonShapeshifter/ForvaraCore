import { NextFunction, Response } from 'express';
import { AppDelegatesService } from '@/services/app-delegates.service';
import { error } from '@/utils/responses';

const delegatesService = new AppDelegatesService();

// =====================================================
// DELEGATE CHECK MIDDLEWARE
// Simple check if user is delegate for specific app
// =====================================================

export const checkDelegate = (appId: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      // Skip if user is owner
      if (req.user.role === 'owner') {
        req.is_delegate = false; // Owner doesn't need delegate status
        return next();
      }
      
      // Check if user is delegate for this app
      const isDelegate = await delegatesService.isDelegate({
        appId,
        userId: req.user.id,
        companyId: req.company.id
      });
      
      req.is_delegate = isDelegate;
      
      if (!isDelegate) {
        return error(res, 'Access denied. You need delegate status for this app.', 403);
      }
      
      next();
    } catch (err: any) {
      return error(res, 'Failed to check delegate status', 500);
    }
  };
};

// =====================================================
// REQUIRE OWNER OR DELEGATE
// For endpoints that need sudo access within app
// =====================================================

export const requireOwnerOrDelegate = (appId: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      // Owner always has access
      if (req.user.role === 'owner') {
        req.sudo_mode = true;
        req.sudo_reason = 'owner';
        return next();
      }
      
      // Check if user is delegate
      const isDelegate = await delegatesService.isDelegate({
        appId,
        userId: req.user.id,
        companyId: req.company.id
      });
      
      if (!isDelegate) {
        return error(res, 'Access denied. Owner or delegate status required.', 403);
      }
      
      req.sudo_mode = true;
      req.sudo_reason = 'delegate';
      
      next();
    } catch (err: any) {
      return error(res, 'Failed to check permissions', 500);
    }
  };
};

// =====================================================
// OPTIONAL DELEGATE CHECK
// Sets flag but doesn't block access
// =====================================================

export const optionalDelegateCheck = (appId: string) => {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      // Owner always has sudo
      if (req.user.role === 'owner') {
        req.sudo_mode = true;
        req.sudo_reason = 'owner';
        return next();
      }
      
      // Check delegate status
      const isDelegate = await delegatesService.isDelegate({
        appId,
        userId: req.user.id,
        companyId: req.company.id
      });
      
      req.sudo_mode = isDelegate;
      req.sudo_reason = isDelegate ? 'delegate' : 'none';
      
      next();
    } catch (err: any) {
      // On error, proceed without sudo
      req.sudo_mode = false;
      req.sudo_reason = 'error';
      next();
    }
  };
};