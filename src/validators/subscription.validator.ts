import { z } from 'zod';

export const subscribeValidator = z.object({
  body: z.object({
    app_id: z.string().uuid(),
    plan_id: z.string(),
    billing_cycle: z.enum(['monthly', 'yearly']).optional()
  })
});

export const updateSubscriptionValidator = z.object({
  body: z.object({
    plan_id: z.string().optional(),
    billing_cycle: z.enum(['monthly', 'yearly']).optional(),
    auto_renew: z.boolean().optional()
  })
});

export const cancelSubscriptionValidator = z.object({
  body: z.object({
    reason: z.string().optional(),
    feedback: z.string().optional(),
    immediate: z.boolean().optional()
  })
});

export const addAddonValidator = z.object({
  body: z.object({
    addon_id: z.string(),
    quantity: z.number().int().positive().optional()
  })
});