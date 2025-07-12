import { z } from 'zod';

export const updateProfileValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    email: z.string().email().optional(),
    phone: z.string().min(10).optional(),
    avatar_url: z.string().url().optional()
  })
});

export const updateSettingsValidator = z.object({
  body: z.object({
    settings: z.record(z.any()),
    type: z.enum(['preferences', 'notifications', 'security']).optional()
  })
});

export const updateAvatarValidator = z.object({
  files: z.object({
    avatar: z.any()
  })
});