import { z } from 'zod';

export const createChannelValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['public', 'private', 'direct']),
    description: z.string().max(500).optional(),
    members: z.array(z.string().uuid()).optional()
  })
});

export const updateChannelValidator = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    is_archived: z.boolean().optional()
  })
});

export const sendMessageValidator = z.object({
  body: z.object({
    content: z.string().min(1).max(5000),
    type: z.enum(['text', 'file', 'image']).optional(),
    attachments: z.array(z.object({
      url: z.string().url(),
      name: z.string(),
      size: z.number()
    })).optional()
  })
});

export const updateMessageValidator = z.object({
  body: z.object({
    content: z.string().min(1).max(5000),
    edited: z.boolean().optional()
  })
});