import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class TenantService {
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
              id, name, slug, description, logo_url, 
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
}