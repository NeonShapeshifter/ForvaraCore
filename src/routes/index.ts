import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './users.routes';
import tenantRoutes from './tenants.routes';
import subscriptionRoutes from './subscriptions.routes';
import fileRoutes from './files.routes';
import mailRoutes from './mail.routes';
import teamRoutes from './team.routes';
import notificationRoutes from './notifications.routes';
import activityRoutes from './activity.routes';
import metricsRoutes from './metrics.routes';
import integrationRoutes from './integration.routes';
import hubRoutes from './hub.routes';
import appRoutes from './apps.routes';
import healthRoutes from './health.routes';
import webhookRoutes from './webhooks.routes';

const router = Router();

// Rutas públicas
router.use('/health', healthRoutes);
router.use('/webhooks', webhookRoutes);

// Rutas de autenticación (parcialmente públicas)
router.use('/auth', authRoutes);

// Rutas protegidas (requieren autenticación)
router.use('/users', userRoutes);
router.use('/tenants', tenantRoutes);
router.use('/team', teamRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/files', fileRoutes);
router.use('/mail', mailRoutes);
router.use('/notifications', notificationRoutes);
router.use('/activity', activityRoutes);
router.use('/metrics', metricsRoutes);
router.use('/integration', integrationRoutes);
router.use('/hub', hubRoutes);
router.use('/apps', appRoutes);

// Versioning support
router.get('/version', (req, res) => {
  res.json({
    version: '2.0.0',
    api: 'v1',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

export default router;
