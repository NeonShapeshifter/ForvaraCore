import { z } from 'zod';

export const createTenantValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(255),
    domain: z.string().min(3).max(63).optional(),
    settings: z.record(z.any()).optional()
  })
});

export const updateTenantValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    domain: z.string().min(3).max(63).optional(),
    settings: z.record(z.any()).optional(),
    is_active: z.boolean().optional()
  })
});