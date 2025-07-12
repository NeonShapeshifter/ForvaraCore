import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from '../config/database';
import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import { emailService } from './email.service';
import { notificationService } from './notification.service';
import { activityService } from './activity.service';
import { NotFoundError, ValidationError, AuthorizationError } from '../types';
import { ACTIVITY_ACTIONS } from '../constants';

interface TeamMember {
  id: string;
  user_id: string;
  company_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  permissions: string[];
  is_active: boolean;
  invited_by: string;
  joined_at?: string;
  created_at: string;
}

interface InviteParams {
  tenantId: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  invitedBy: string;
  message?: string;
  permissions?: string[];
}

class TeamService {
  private supabase = getSupabase();
  private redis = getRedis();

  async getMembers(tenantId: string, includeInvites = false) {
    try {
      const cacheKey = `team:${tenantId}:members`;
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      let query = this.supabase
        .from('company_members')
        .select(`
          *,
          user:users(id, email, name, avatar_url),
          invited_by_user:users!invited_by(name, email)
        `)
        .eq('company_id', tenantId);

      if (!includeInvites) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;
      if (error) throw error;

      await this.redis.setex(cacheKey, 300, JSON.stringify(data));
      return data;
    } catch (error) {
      logger.error('Get team members failed:', error);
      throw error;
    }
  }

  async inviteMember(params: InviteParams) {
    try {
      // Check if user already exists
      const { data: existingUser } = await this.supabase
        .from('users')
        .select('id')
        .eq('email', params.email)
        .single();

      // Check if already a member
      const { data: existingMember } = await this.supabase
        .from('company_members')
        .select('id, is_active')
        .eq('company_id', params.tenantId)
        .eq('user_id', existingUser?.id || '')
        .single();

      if (existingMember?.is_active) {
        throw new ValidationError('User is already a member');
      }

      const invitationId = uuidv4();
      const inviteToken = uuidv4();

      if (existingMember && !existingMember.is_active) {
        // Reactivate existing member
        await this.supabase
          .from('company_members')
          .update({
            is_active: true,
            role: params.role,
            permissions: params.permissions || [],
            updated_at: new Date().toISOString()
          })
          .eq('id', existingMember.id);
      } else {
        // Create new invitation
        await this.supabase
          .from('team_invitations')
          .insert({
            id: invitationId,
            company_id: params.tenantId,
            email: params.email,
            role: params.role,
            permissions: params.permissions || [],
            invited_by: params.invitedBy,
            token: inviteToken,
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
          });
      }

      // Send invitation email
      await emailService.sendEmail({
        to: params.email,
        subject: 'You have been invited to join a team on Forvara',
        template: 'team-invitation',
        data: {
          inviteToken,
          role: params.role,
          message: params.message
        }
      });

      // Create notification for inviter
      await notificationService.create({
        userId: params.invitedBy,
        tenantId: params.tenantId,
        title: 'Team invitation sent',
        message: `Invitation sent to ${params.email}`,
        type: 'team'
      });

      // Log activity
      await activityService.create({
        tenantId: params.tenantId,
        userId: params.invitedBy,
        action: ACTIVITY_ACTIONS.TEAM_MEMBER_INVITED,
        resource: 'team_member',
        resourceId: invitationId,
        metadata: { email: params.email, role: params.role }
      });

      await this.redis.del(`team:${params.tenantId}:*`);
      return { invitationId, email: params.email };
    } catch (error) {
      logger.error('Invite member failed:', error);
      throw error;
    }
  }

  async updateMember(tenantId: string, memberId: string, updates: any, updatedBy: string) {
    try {
      const { data: member } = await this.supabase
        .from('company_members')
        .select('*')
        .eq('id', memberId)
        .eq('company_id', tenantId)
        .single();

      if (!member) {
        throw new NotFoundError('Member not found');
      }

      if (member.role === 'owner' && updates.role !== 'owner') {
        // Check if there's another owner
        const { data: owners } = await this.supabase
          .from('company_members')
          .select('id')
          .eq('company_id', tenantId)
          .eq('role', 'owner')
          .neq('id', memberId);

        if (!owners || owners.length === 0) {
          throw new ValidationError('Cannot remove the last owner');
        }
      }

      const { error } = await this.supabase
        .from('company_members')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', memberId);

      if (error) throw error;

      await activityService.create({
        tenantId,
        userId: updatedBy,
        action: ACTIVITY_ACTIONS.TEAM_MEMBER_UPDATED,
        resource: 'team_member',
        resourceId: memberId,
        metadata: updates
      });

      await this.redis.del(`team:${tenantId}:*`);
      return { success: true };
    } catch (error) {
      logger.error('Update member failed:', error);
      throw error;
    }
  }

  async removeMember(tenantId: string, memberId: string, removedBy: string) {
    try {
      const { data: member } = await this.supabase
        .from('company_members')
        .select('*, user:users(email)')
        .eq('id', memberId)
        .eq('company_id', tenantId)
        .single();

      if (!member) {
        throw new NotFoundError('Member not found');
      }

      if (member.role === 'owner') {
        throw new ValidationError('Cannot remove an owner');
      }

      const { error } = await this.supabase
        .from('company_members')
        .update({
          is_active: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', memberId);

      if (error) throw error;

      await activityService.create({
        tenantId,
        userId: removedBy,
        action: ACTIVITY_ACTIONS.TEAM_MEMBER_REMOVED,
        resource: 'team_member',
        resourceId: memberId,
        metadata: { email: member.user.email }
      });

      await this.redis.del(`team:${tenantId}:*`);
      return { success: true };
    } catch (error) {
      logger.error('Remove member failed:', error);
      throw error;
    }
  }

  async bulkInvite(tenantId: string, invitations: InviteParams[], invitedBy: string) {
    try {
      const results = await Promise.allSettled(
        invitations.map(invite => 
          this.inviteMember({ ...invite, tenantId, invitedBy })
        )
      );

      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      return {
        successful: successful.length,
        failed: failed.length,
        errors: failed.map((r: any) => ({
          email: invitations[results.indexOf(r)].email,
          error: r.reason?.message || 'Unknown error'
        }))
      };
    } catch (error) {
      logger.error('Bulk invite failed:', error);
      throw error;
    }
  }
}

export const teamService = new TeamService();