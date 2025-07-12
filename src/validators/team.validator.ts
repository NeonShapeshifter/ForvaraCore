import { z } from 'zod';

export const inviteMemberValidator = z.object({
  body: z.object({
    email: z.string().email(),
    role: z.enum(['admin', 'member', 'viewer']),
    message: z.string().max(500).optional(),
    permissions: z.array(z.string()).optional()
  })
});

export const updateMemberValidator = z.object({
  body: z.object({
    role: z.enum(['admin', 'member', 'viewer']).optional(),
    permissions: z.array(z.string()).optional(),
    is_active: z.boolean().optional()
  })
});

export const bulkInviteValidator = z.object({
  body: z.object({
    invitations: z.array(z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member', 'viewer']),
      permissions: z.array(z.string()).optional()
    })).min(1).max(50)
  })
});