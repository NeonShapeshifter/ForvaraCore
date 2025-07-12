import { Router } from 'express';
import { success } from '@/utils/responses';

const router = Router();

router.get('/', (req, res) => {
  return success(res, {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

export { router as healthRoutes };