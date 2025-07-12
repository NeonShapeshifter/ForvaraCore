import { z } from 'zod';

export const validateAccessValidator = z.object({
  body: z.object({
    app_id: z.string().uuid(),
    permissions: z.array(z.string()).optional()
  })
});

export const shareDataValidator = z.object({
  body: z.object({
    target_app_id: z.string().uuid(),
    data_types: z.array(z.string()),
    expires_at: z.string().datetime().optional()
  })
});

export const createWebhookValidator = z.object({
  body: z.object({
    url: z.string().url(),
    events: z.array(z.string()).min(1),
    secret: z.string().min(16).optional(),
    is_active: z.boolean().optional()
  })
});