import { Router } from 'express';
import { success, error } from '@/utils/responses';
import { safeAsync } from '@/utils/safeAsync';
import { authenticate } from '@/middleware/auth';
import { supabase } from '@/config/database';
import { safeSupabaseQuery } from '@/utils/safeAsync';

const router = Router();

// Public marketplace endpoints (no auth required)
router.get('/apps', safeAsync(async (req: any, res: any) => {
  try {
    const { category, featured, search } = req.query;

    let query = supabase
      .from('apps')
      .select(`
        id, name, description, category, logo_url, 
        pricing_model, base_price, featured, rating, 
        downloads_count, status, created_at
      `)
      .eq('status', 'published');

    if (category) {
      query = query.eq('category', category);
    }

    if (featured === 'true') {
      query = query.eq('featured', true);
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%, description.ilike.%${search}%`);
    }

    const { data: apps } = await safeSupabaseQuery(
      query.order('featured', { ascending: false }).order('downloads_count', { ascending: false }),
      { data: [], error: null }
    );

    // Transform to match frontend interface
    const transformedApps = apps?.map((app: any) => ({
      id: app.id,
      name: app.name,
      description: app.description,
      category: app.category,
      price: app.base_price ? `$${app.base_price}` : 'Gratis',
      priceType: app.pricing_model || 'free',
      rating: app.rating || 4.5,
      downloads: app.downloads_count ? `${Math.floor(app.downloads_count / 100)}00+` : '0',
      features: [], // This would come from a features table
      status: 'available',
      featured: app.featured || false
    })) || [];

    // Add fallback apps if database is empty
    if (transformedApps.length === 0) {
      return success(res, [
        {
          id: 'elaris-erp',
          name: 'Elaris ERP',
          description: 'Sistema completo de gestión empresarial con módulos integrados',
          category: 'ERP & Gestión',
          price: '$49',
          priceType: 'monthly',
          rating: 4.8,
          downloads: '1.2k',
          features: ['Contabilidad', 'Inventario', 'Ventas', 'Compras', 'Reportes'],
          status: 'available',
          featured: true
        },
        {
          id: 'forvara-mail',
          name: 'ForvaraMail',
          description: 'Comunicación empresarial estilo Discord para equipos modernos',
          category: 'Comunicación',
          price: '$19',
          priceType: 'monthly',
          rating: 4.7,
          downloads: '850',
          features: ['Chat en tiempo real', 'Canales por proyecto', 'Videollamadas'],
          status: 'coming-soon',
          featured: true
        },
        {
          id: 'forvara-analytics',
          name: 'ForvaraAnalytics',
          description: 'Business intelligence y reportes avanzados para PyMEs',
          category: 'Analytics',
          price: '$39',
          priceType: 'monthly',
          rating: 4.6,
          downloads: '640',
          features: ['Dashboards interactivos', 'Reportes automáticos', 'Predicciones'],
          status: 'coming-soon',
          featured: false
        },
        {
          id: 'elaris-contabilidad',
          name: 'Elaris Contabilidad',
          description: 'Módulo de contabilidad con facturación electrónica DGI',
          category: 'Contabilidad',
          price: '$29',
          priceType: 'monthly',
          rating: 4.7,
          downloads: '920',
          features: ['Facturación DGI', 'Estados financieros', 'Declaraciones'],
          status: 'available',
          featured: false
        },
        {
          id: 'elaris-inventario',
          name: 'Elaris Inventario',
          description: 'Control de inventario y gestión de almacén',
          category: 'Inventario',
          price: '$25',
          priceType: 'monthly',
          rating: 4.5,
          downloads: '750',
          features: ['Control de stock', 'Alertas', 'Códigos de barras'],
          status: 'available',
          featured: false
        }
      ]);
    }

    return success(res, transformedApps);
  } catch (err: any) {
    console.error('Error fetching marketplace apps:', err);
    return error(res, err.message, 500);
  }
}));

// Get app categories
router.get('/categories', safeAsync(async (req: any, res: any) => {
  try {
    const { data: categories } = await safeSupabaseQuery(
      supabase
        .from('apps')
        .select('category')
        .eq('status', 'published'),
      { data: [], error: null }
    );

    const uniqueCategories = [...new Set(categories?.map((app: any) => app.category))];
    
    // Add default categories if none exist
    const defaultCategories = [
      'ERP & Gestión',
      'Contabilidad',
      'Inventario', 
      'CRM & Ventas',
      'Comunicación',
      'Analytics',
      'Recursos Humanos',
      'Marketing'
    ];

    const finalCategories = uniqueCategories.length > 0 ? uniqueCategories : defaultCategories;

    return success(res, finalCategories);
  } catch (err: any) {
    console.error('Error fetching categories:', err);
    return error(res, err.message, 500);
  }
}));

// Get specific app details
router.get('/apps/:appId', safeAsync(async (req: any, res: any) => {
  try {
    const { appId } = req.params;

    const { data: app } = await safeSupabaseQuery(
      supabase
        .from('apps')
        .select('*')
        .eq('id', appId)
        .eq('status', 'published')
        .single(),
      { data: null, error: null }
    );

    if (!app) {
      return error(res, 'App not found', 404);
    }

    // Transform to frontend format
    const transformedApp = {
      id: app.id,
      name: app.name,
      description: app.description,
      longDescription: app.long_description,
      category: app.category,
      price: app.base_price ? `$${app.base_price}` : 'Gratis',
      priceType: app.pricing_model || 'free',
      rating: app.rating || 4.5,
      downloads: app.downloads_count ? `${Math.floor(app.downloads_count / 100)}00+` : '0',
      features: app.features || [],
      screenshots: app.screenshots || [],
      status: 'available',
      featured: app.featured || false,
      developer: app.developer || 'Forvara',
      version: app.version || '1.0.0',
      requirements: app.requirements || [],
      changelog: app.changelog || []
    };

    return success(res, transformedApp);
  } catch (err: any) {
    console.error('Error fetching app details:', err);
    return error(res, err.message, 500);
  }
}));

export { router as marketplaceRoutes };