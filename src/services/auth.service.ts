import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

export class AuthService {
  async login(email: string, password: string) {
    try {
      if (!email || !password) {
        throw new Error('Email and password are required');
      }

      // Buscar usuario por email
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('*')
          .eq('email', email.toLowerCase())
          .single(),
        { data: null, error: null }
      );

      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Verificar password
      const isValid = await bcrypt.compare(password, (user as any)?.password_hash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      // Obtener companies del usuario
      const { data: companies } = await safeSupabaseQuery(
        supabase
          .from('company_members')
          .select(`
            role,
            status,
            joined_at,
            companies (
              id, name, slug, description, logo_url, 
              storage_used_bytes, storage_limit_bytes, status, 
              subscription_status, monthly_revenue, created_at, updated_at
            )
          `)
          .eq('user_id', (user as any)?.id)
          .eq('status', 'active')
          .order('joined_at', { ascending: false }),
        { data: [], error: null }
      );

      const userCompanies = companies?.map((m: any) => ({
        ...(m.companies as any),
        user_role: m.role,
        joined_at: m.joined_at,
        // Transform for frontend compatibility
        storage_used: Math.floor(((m.companies as any)?.storage_used_bytes || 0) / 1024 / 1024), // MB
        storage_limit: Math.floor(((m.companies as any)?.storage_limit_bytes || 5368709120) / 1024 / 1024), // MB
        user_count: 0 // TODO: Calculate actual user count
      })).filter(Boolean) || [];

      // Actualizar last_login_at
      await supabase
        .from('users')
        .update({ last_login_at: new Date().toISOString() })
        .eq('id', (user as any)?.id);

      // Generar JWT token
      const token = jwt.sign(
        { 
          userId: (user as any)?.id, 
          email: (user as any)?.email 
        },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' } as jwt.SignOptions
      );

      return {
        user: {
          id: (user as any)?.id,
          name: (user as any)?.name,
          full_name: (user as any)?.name, // Frontend expects both
          email: (user as any)?.email,
          phone: (user as any)?.phone,
          avatar_url: (user as any)?.avatar_url,
          created_at: (user as any)?.created_at,
          status: (user as any)?.status || 'active'
        },
        token,
        companies: userCompanies
      };
    } catch (error: any) {
      console.error('❌ Login error:', error);
      throw new Error(error.message || 'Login failed');
    }
  }

  async register(data: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    company_name?: string;
  }) {
    try {
      const { name, email, password, phone, company_name } = data;

      if (!name || !email || !password) {
        throw new Error('Name, email and password are required');
      }

      if (password.length < 6) {
        throw new Error('Password must be at least 6 characters');
      }

      // Verificar si el usuario ya existe
      const { data: existing } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id')
          .eq('email', email.toLowerCase())
          .single(),
        { data: null, error: null }
      );

      if (existing) {
        throw new Error('User already exists');
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Crear usuario
      const { data: user, error } = await supabase
        .from('users')
        .insert({
          name: name.trim(),
          email: email.toLowerCase(),
          password_hash: passwordHash,
          phone: phone?.trim() || null,
          status: 'active'
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Registration failed: ${error.message}`);
      }

      let company = null;

      // Crear company si se proporciona company_name
      if (company_name && company_name.trim()) {
        const slug = company_name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');

        const { data: newCompany, error: companyError } = await supabase
          .from('companies')
          .insert({
            name: company_name.trim(),
            slug: `${slug}-${Date.now()}`,
            created_by: (user as any)?.id,
            status: 'active'
          })
          .select()
          .single();

        if (!companyError && newCompany) {
          company = newCompany;

          // Agregar usuario como owner de la company
          await supabase
            .from('company_members')
            .insert({
              user_id: (user as any)?.id,
              company_id: (newCompany as any)?.id,
              role: 'owner',
              status: 'active'
            });
        }
      }

      // Generar JWT token
      const token = jwt.sign(
        { 
          userId: (user as any)?.id, 
          email: (user as any)?.email 
        },
        process.env.JWT_SECRET!,
        { expiresIn: '7d' } as jwt.SignOptions
      );

      const result: any = {
        user: {
          id: (user as any)?.id,
          name: (user as any)?.name,
          full_name: (user as any)?.name,
          email: (user as any)?.email,
          phone: (user as any)?.phone,
          avatar_url: (user as any)?.avatar_url,
          created_at: (user as any)?.created_at,
          status: (user as any)?.status || 'active'
        },
        token
      };

      // Agregar company si se creó
      if (company) {
        result.company = {
          ...(company as any),
          user_role: 'owner',
          storage_used: 0,
          storage_limit: Math.floor(5368709120 / 1024 / 1024), // 5GB in MB
          user_count: 1
        };
      }

      return result;
    } catch (error: any) {
      console.error('❌ Register error:', error);
      throw new Error(error.message || 'Registration failed');
    }
  }

  async validateToken(token: string) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
      
      // Buscar usuario actualizado
      const { data: user } = await safeSupabaseQuery(
        supabase
          .from('users')
          .select('id, name, email, phone, avatar_url, status')
          .eq('id', decoded.userId)
          .single(),
        { data: null, error: null }
      );

      if (!user || (user as any)?.status !== 'active') {
        throw new Error('User not found or inactive');
      }

      return user as any;
    } catch (error: any) {
      console.error('❌ Token validation error:', error);
      throw new Error('Invalid token');
    }
  }
}