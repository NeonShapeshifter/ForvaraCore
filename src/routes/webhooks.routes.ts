import { Router } from 'express';
import * as webhookController from '../controllers/webhooks.controller';
import { validateBody } from '../middleware/validation';
// validateHeaders no existe - temporalmente comentado
import { z } from 'zod';
import { logger } from '../config/logger';

const router = Router();

// Middleware para verificar firma de webhook
const verifyWebhookSignature = (secret: string) => {
  return (req: any, res: any, next: any) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    
    if (!signature || !timestamp) {
      logger.warn({
        ip: req.ip,
        path: req.path
      }, 'Webhook request without signature');
      
      return res.status(401).json({
        error: 'Missing webhook signature'
      });
    }

    // Verificar timestamp (no más de 5 minutos)
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTime = parseInt(timestamp);
    
    if (Math.abs(currentTime - webhookTime) > 300) {
      return res.status(401).json({
        error: 'Webhook timestamp too old'
      });
    }

    // Verificar firma
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${req.rawBody || JSON.stringify(req.body)}`)
      .digest('hex');

    if (signature !== expectedSignature) {
      logger.warn({
        ip: req.ip,
        path: req.path,
        receivedSignature: signature
      }, 'Invalid webhook signature');
      
      return res.status(401).json({
        error: 'Invalid webhook signature'
      });
    }

    next();
  };
};

/**
 * @swagger
 * /api/webhooks/stripe:
 *   post:
 *     summary: Webhook de Stripe
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook procesado
 */
router.post('/stripe',
  verifyWebhookSignature(process.env.STRIPE_WEBHOOK_SECRET!),
  webhookController.handleStripeWebhook
);

/**
 * @swagger
 * /api/webhooks/github:
 *   post:
 *     summary: Webhook de GitHub
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook procesado
 */
router.post('/github',
  // validateHeaders(z.object({
  //   'x-github-event': z.string(),
  //   'x-github-signature-256': z.string()
  // })), // Temporalmente comentado
  webhookController.handleGithubWebhook
);

/**
 * @swagger
 * /api/webhooks/custom/{webhookId}:
 *   post:
 *     summary: Webhook personalizado
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook procesado
 */
router.post('/custom/:webhookId',
  validateBody(z.object({
    event: z.string(),
    data: z.any(),
    timestamp: z.string().datetime().optional()
  })),
  webhookController.handleCustomWebhook
);

// Endpoint para verificar que los webhooks funcionan
router.get('/test', (req, res) => {
  res.json({
    message: 'Webhook endpoint is working',
    timestamp: new Date().toISOString()
  });
});

export default router;
