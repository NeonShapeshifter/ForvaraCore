import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';
import { EmailService } from './email.service.js';

export class TenantService {
  private emailService = new EmailService();
  async getUserCompanies(userId: string) {
    try {
      const { data: memberships } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select(`
            role,
            status,
            joined_at,
            companies (
              id, razon_social, slug, description, logo_url, 
              storage_used_bytes, status, created_at, updated_at
            )
          `)
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('joined_at', { ascending: false }),
        { data: [], error: null }
      );

      const companies = memberships?.map((m: any) => ({
        ...m.companies,
        name: m.companies.razon_social, // Map razon_social to name for frontend compatibility
        user_role: m.role,
        joined_at: m.joined_at
      })).filter(Boolean) || [];

      return companies;
    } catch (error: any) {
      console.error('❌ Get user companies error:', error);
      throw new Error('Failed to get companies');
    }
  }

  async getCompany(companyId: string, userId: string) {
    try {
      // Verificar acceso del usuario
      const { data: membership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!membership) {
        throw new Error('Access denied to this company');
      }

      const { data: company } = await safeSupabaseQuery(
        supabase
          .from('companies')
          .select('*')
          .eq('id', companyId)
          .single(),
        { data: null, error: null }
      );

      if (!company) {
        throw new Error('Company not found');
      }

      return {
        ...(company as any),
        user_role: (membership as any)?.role
      };
    } catch (error: any) {
      console.error('❌ Get company error:', error);
      throw new Error(error.message || 'Failed to get company');
    }
  }

  async createCompany(data: {
    name: string;
    description?: string;
    userId: string;
  }) {
    try {
      const { name, description, userId } = data;

      if (!name || name.trim().length < 2) {
        throw new Error('Company name is required (min 2 characters)');
      }

      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const companyId = uuidv4();

      // Crear company
      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
          id: companyId,
          name: name.trim(),
          slug: `${slug}-${Date.now()}`,
          description: description?.trim() || null,
          created_by: userId
        })
        .select()
        .single();

      if (companyError) {
        throw new Error(`Company creation failed: ${companyError.message}`);
      }

      // Agregar usuario como owner
      const { error: memberError } = await supabase
        .from('company_members')
        .insert({
          user_id: userId,
          company_id: companyId,
          role: 'owner',
          status: 'active'
        });

      if (memberError) {
        console.error('❌ Failed to create membership:', memberError);
        // No fallar completamente, la company ya existe
      }

      return {
        ...company,
        user_role: 'owner'
      };
    } catch (error: any) {
      console.error('❌ Create company error:', error);
      throw new Error(error.message || 'Failed to create company');
    }
  }

  async updateCompany(companyId: string, userId: string, data: {
    name?: string;
    description?: string;
    logo_url?: string;
  }) {
    try {
      // Verificar permisos (admin o owner)
      const { data: membership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!membership || !['owner', 'admin'].includes((membership as any)?.role)) {
        throw new Error('Permission denied');
      }

      const updateData: any = {};
      
      if (data.name && data.name.trim()) {
        updateData.name = data.name.trim();
      }
      
      if (data.description !== undefined) {
        updateData.description = data.description?.trim() || null;
      }
      
      if (data.logo_url !== undefined) {
        updateData.logo_url = data.logo_url?.trim() || null;
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No valid data to update');
      }

      const { data: company, error } = await supabase
        .from('companies')
        .update(updateData)
        .eq('id', companyId)
        .select()
        .single();

      if (error) {
        throw new Error(`Update failed: ${error.message}`);
      }

      return {
        ...(company as any),
        user_role: (membership as any)?.role
      };
    } catch (error: any) {
      console.error('❌ Update company error:', error);
      throw new Error(error.message || 'Failed to update company');
    }
  }

  async getMembers(companyId: string, userId: string) {
    try {
      // Verificar acceso del usuario
      const { data: userMembership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!userMembership) {
        throw new Error('Access denied to this company');
      }

      const { data: members } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select(`
            id, role, status, joined_at,
            users (
              id, name, email, phone, avatar_url
            )
          `)
          .eq('company_id', companyId)
          .order('joined_at', { ascending: false }),
        { data: [], error: null }
      );

      return members?.map((m: any) => ({
        id: m.id,
        role: m.role,
        status: m.status,
        joined_at: m.joined_at,
        user: m.users
      })) || [];
    } catch (error: any) {
      console.error('❌ Get members error:', error);
      throw new Error(error.message || 'Failed to get members');
    }
  }

  async inviteUser(data: {
    companyId: string;
    invitedBy: string;
    email?: string;
    phone?: string;
    role: string;
  }) {
    try {
      const { companyId, invitedBy, email, phone, role } = data;

      // Verificar permisos del que invita (admin o owner)
      const { data: inviterMembership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', invitedBy)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!inviterMembership || !['owner', 'admin'].includes((inviterMembership as any)?.role)) {
        throw new Error('Permission denied - only admins and owners can invite users');
      }

      // Validar que al menos email o phone esté presente
      if (!email && !phone) {
        throw new Error('Either email or phone is required for invitation');
      }

      // Validar rol
      const validRoles = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(role)) {
        throw new Error('Invalid role specified');
      }

      // No permitir crear owners a menos que seas owner
      if (role === 'owner' && (inviterMembership as any)?.role !== 'owner') {
        throw new Error('Only owners can invite other owners');
      }

      // Crear invitación
      const inviteId = uuidv4();
      const { data: invitation, error } = await supabase
        .from('company_invitations')
        .insert({
          id: inviteId,
          company_id: companyId,
          invited_by: invitedBy,
          invite_email: email || null,
          invite_phone: phone || null,
          role,
          status: 'pending',
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Invitation creation failed: ${error.message}`);
      }

      // Send invitation email
      if (email) {
        try {
          // Get inviter and company info for email
          const { data: inviter } = await safeSupabaseQuery(
            supabase
              .from('users')
              .select('name, email')
              .eq('id', invitedBy)
              .single(),
            { data: null, error: null }
          );

          const { data: company } = await safeSupabaseQuery(
            supabase
              .from('companies')
              .select('name')
              .eq('id', companyId)
              .single(),
            { data: null, error: null }
          );

          if (inviter && company) {
            const inviteLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invitation/${inviteId}`;
            
            await this.emailService.sendInvitationEmail(email, {
              inviterName: (inviter as any)?.name || 'Un miembro del equipo',
              companyName: (company as any)?.name,
              role: role,
              inviteLink: inviteLink,
              expiresAt: (invitation as any)?.expires_at
            });
            
            console.log('✅ Invitation email sent to:', email);
          }
        } catch (emailError) {
          console.error('❌ Failed to send invitation email:', emailError);
          // Don't fail the invitation if email fails
        }
      }

      // TODO: Send invitation SMS if phone is provided

      return invitation;
    } catch (error: any) {
      console.error('❌ Invite user error:', error);
      throw new Error(error.message || 'Failed to invite user');
    }
  }

  async changeMemberRole(companyId: string, memberId: string, userId: string, newRole: string) {
    try {
      // Verificar permisos del que cambia el rol
      const { data: userMembership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!userMembership || !['owner', 'admin'].includes((userMembership as any)?.role)) {
        throw new Error('Permission denied - only admins and owners can change roles');
      }

      // Validar nuevo rol
      const validRoles = ['owner', 'admin', 'member', 'viewer'];
      if (!validRoles.includes(newRole)) {
        throw new Error('Invalid role specified');
      }

      // Solo owners pueden crear otros owners
      if (newRole === 'owner' && (userMembership as any)?.role !== 'owner') {
        throw new Error('Only owners can promote to owner role');
      }

      // Verificar que el miembro existe
      const { data: targetMember } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('user_id, role')
          .eq('id', memberId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!targetMember) {
        throw new Error('Member not found');
      }

      // No permitir cambiar tu propio rol de owner
      if ((targetMember as any)?.user_id === userId && (targetMember as any)?.role === 'owner' && newRole !== 'owner') {
        throw new Error('Cannot remove yourself from owner role');
      }

      const { data: updatedMember, error } = await supabase
        .from('company_members')
        .update({ role: newRole })
        .eq('id', memberId)
        .eq('company_id', companyId)
        .select(`
          id, role, status, joined_at,
          users (
            id, name, email, phone, avatar_url
          )
        `)
        .single();

      if (error) {
        throw new Error(`Role change failed: ${error.message}`);
      }

      return {
        id: (updatedMember as any)?.id,
        role: (updatedMember as any)?.role,
        status: (updatedMember as any)?.status,
        joined_at: (updatedMember as any)?.joined_at,
        user: (updatedMember as any)?.users
      };
    } catch (error: any) {
      console.error('❌ Change member role error:', error);
      throw new Error(error.message || 'Failed to change member role');
    }
  }

  async removeMember(companyId: string, memberId: string, userId: string) {
    try {
      // Verificar permisos
      const { data: userMembership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!userMembership || !['owner', 'admin'].includes((userMembership as any)?.role)) {
        throw new Error('Permission denied - only admins and owners can remove members');
      }

      // Verificar que el miembro existe
      const { data: targetMember } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('user_id, role')
          .eq('id', memberId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!targetMember) {
        throw new Error('Member not found');
      }

      // No permitir remover el último owner
      if ((targetMember as any)?.role === 'owner') {
        const { data: ownerCount } = await safeSupabaseQuery(
          supabase
            .from('company_members')
            .select('id')
            .eq('company_id', companyId)
            .eq('role', 'owner')
            .eq('status', 'active'),
          { data: [], error: null }
        );

        if ((ownerCount?.length || 0) <= 1) {
          throw new Error('Cannot remove the last owner from the company');
        }
      }

      // Marcar como inactive en lugar de eliminar (para auditoría)
      const { error } = await supabase
        .from('company_members')
        .update({ 
          status: 'removed',
          removed_at: new Date().toISOString(),
          removed_by: userId
        })
        .eq('id', memberId)
        .eq('company_id', companyId);

      if (error) {
        throw new Error(`Member removal failed: ${error.message}`);
      }

      return true;
    } catch (error: any) {
      console.error('❌ Remove member error:', error);
      throw new Error(error.message || 'Failed to remove member');
    }
  }

  async getPendingInvitations(companyId: string, userId: string) {
    try {
      // Verificar acceso
      const { data: userMembership } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('role')
          .eq('user_id', userId)
          .eq('company_id', companyId)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (!userMembership) {
        throw new Error('Access denied to this company');
      }

      const { data: invitations } = await safeSupabaseQuery(
        supabase
          .from('company_invitations')
          .select(`
            id, invite_email, invite_phone, role, status, created_at, expires_at,
            inviter:users!company_invitations_invited_by_fkey (
              id, name, email
            )
          `)
          .eq('company_id', companyId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false }),
        { data: [], error: null }
      );

      return invitations || [];
    } catch (error: any) {
      console.error('❌ Get pending invitations error:', error);
      throw new Error(error.message || 'Failed to get pending invitations');
    }
  }

  async acceptInvitation(inviteId: string, userId: string) {
    try {
      // Obtener invitación
      const { data: invitation } = await safeSupabaseQuery(
        supabase
          .from('company_invitations')
          .select('*')
          .eq('id', inviteId)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString())
          .single(),
        { data: null, error: null }
      );

      if (!invitation) {
        throw new Error('Invitation not found or expired');
      }

      // Verificar que el usuario coincide con la invitación
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('email, phone')
          .eq('id', userId)
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('User not found');
      }

      const inviteEmail = (invitation as any)?.invite_email;
      const invitePhone = (invitation as any)?.invite_phone;
      const userEmail = (user as any)?.email;
      const userPhone = (user as any)?.phone;

      if (inviteEmail && userEmail !== inviteEmail) {
        throw new Error('Email does not match invitation');
      }

      if (invitePhone && userPhone !== invitePhone) {
        throw new Error('Phone does not match invitation');
      }

      // Verificar que no sea ya miembro
      const { data: existingMember } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select('id')
          .eq('user_id', userId)
          .eq('company_id', (invitation as any)?.company_id)
          .eq('status', 'active')
          .single(),
        { data: null, error: null }
      );

      if (existingMember) {
        throw new Error('User is already a member of this company');
      }

      // Crear membership
      const { data: membership, error: memberError } = await supabase
        .from('company_members')
        .insert({
          user_id: userId,
          company_id: (invitation as any)?.company_id,
          role: (invitation as any)?.role,
          status: 'active'
        })
        .select(`
          id, role, status, joined_at,
          companies (
            id, name, slug, description, logo_url
          )
        `)
        .single();

      if (memberError) {
        throw new Error(`Membership creation failed: ${memberError.message}`);
      }

      // Marcar invitación como aceptada
      await supabase
        .from('company_invitations')
        .update({ 
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          accepted_by: userId
        })
        .eq('id', inviteId);

      return membership;
    } catch (error: any) {
      console.error('❌ Accept invitation error:', error);
      throw new Error(error.message || 'Failed to accept invitation');
    }
  }
}