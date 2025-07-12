import { z } from 'zod';

export const uploadFileValidator = z.object({
  body: z.object({
    folder_id: z.string().uuid().optional(),
    app_id: z.string().uuid().optional(),
    description: z.string().max(500).optional()
  }),
  files: z.object({
    file: z.any()
  })
});

export const updateFileValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(500).optional(),
    folder_id: z.string().uuid().optional(),
    is_public: z.boolean().optional()
  })
});

export const shareFileValidator = z.object({
  body: z.object({
    user_ids: z.array(z.string().uuid()).optional(),
    permissions: z.enum(['view', 'edit', 'admin']).optional(),
    expires_at: z.string().datetime().optional()
  })
});