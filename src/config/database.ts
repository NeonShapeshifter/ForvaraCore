import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from './index';
import { logger } from './logger';

let supabase: SupabaseClient;

export const connectDatabase = async (): Promise<void> => {
  try {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'X-Client-Info': 'forvara-core/2.0.0'
        }
      }
    });

    // Test connection
    const { error } = await supabase
      .from('users')
      .select('count', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    logger.info('✅ Database connection established');
  } catch (error) {
    logger.fatal({ error }, '❌ Database connection failed');
    throw error;
  }
};

export const getSupabase = (): SupabaseClient => {
  if (!supabase) {
    // Inicializar automáticamente para desarrollo
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'X-Client-Info': 'forvara-core/2.0.0'
        }
      }
    });
  }
  return supabase;
};

// Helper para transacciones
export const withTransaction = async <T>(
  callback: (client: SupabaseClient) => Promise<T>
): Promise<T> => {
  // Supabase no soporta transacciones directamente
  // Esta es una función placeholder para future implementation
  return callback(supabase);
};

// Helper para queries con retry
export const queryWithRetry = async <T>(
  query: () => Promise<{ data: T | null; error: any }>,
  retries = 3,
  delay = 1000
): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      const { data, error } = await query();
      
      if (error) {
        throw error;
      }
      
      if (!data) {
        throw new Error('No data returned');
      }
      
      return data;
    } catch (error) {
      logger.warn({ error, attempt: i + 1, retries }, 'Query failed, retrying...');
      
      if (i === retries - 1) {
        throw error;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
  
  throw new Error('Query failed after all retries');
};

export { supabase };
