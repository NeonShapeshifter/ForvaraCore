import { z } from 'zod';

export const markReadValidator = z.object({
  body: z.object({
    notification_ids: z.array(z.string().uuid()).optional(),
    mark_all: z.boolean().optional()
  })
});

export const updatePreferencesValidator = z.object({
  body: z.object({
    email_notifications: z.boolean().optional(),
    push_notifications: z.boolean().optional(),
    sms_notifications: z.boolean().optional(),
    notification_types: z.object({
      billing: z.boolean().optional(),
      security: z.boolean().optional(),
      updates: z.boolean().optional(),
      marketing: z.boolean().optional()
    }).optional()
  })
});