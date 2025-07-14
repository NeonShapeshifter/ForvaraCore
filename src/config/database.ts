import { createClient } from '@supabase/supabase-js';

// Ensure environment variables are loaded
if (!process.env.SUPABASE_URL) {
  require('dotenv').config();
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Railway-safe error handling - don't throw errors that crash startup
if (!supabaseUrl) {
  console.error('❌ SUPABASE_URL environment variable is missing');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('SUPABASE')));
  
  // In Railway, create a dummy client instead of crashing
  if (process.env.RAILWAY_ENVIRONMENT) {
    console.warn('⚠️  Creating dummy Supabase client for Railway health checks');
  } else {
    throw new Error('SUPABASE_URL is required');
  }
}

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is missing');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('SUPABASE')));
  
  // In Railway, create a dummy client instead of crashing
  if (process.env.RAILWAY_ENVIRONMENT) {
    console.warn('⚠️  Creating dummy Supabase client for Railway health checks');
  } else {
    throw new Error('SUPABASE_SERVICE_KEY is required');
  }
}

console.log('✅ Supabase configuration loaded successfully');
console.log(`📡 Connecting to: ${supabaseUrl}`);

// Create Supabase client with fallback for Railway
export const supabase = createClient(
  supabaseUrl || 'https://dummy.supabase.co', 
  supabaseServiceKey || 'dummy-key-for-railway', 
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        'User-Agent': 'ForvaraCore/3.0.0'
      }
    }
  }
);

// Railway-safe database connection test
export async function testDatabaseConnection() {
  // Skip database test if we don't have proper credentials
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn('⚠️  Skipping database test - missing credentials');
    return false;
  }

  try {
    console.log('🔍 Testing database connection...');
    
    // Add timeout to prevent hanging
    const dbPromise = supabase
      .from('users')
      .select('count')
      .limit(1);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database timeout after 10s')), 10000)
    );
    
    const { data, error } = await Promise.race([dbPromise, timeoutPromise]) as any;
    
    if (error) {
      console.error('❌ Database connection test failed:', error.message);
      return false;
    } else {
      console.log('✅ Database connection test successful');
      return true;
    }
  } catch (err) {
    console.error('❌ Database connection error:', err);
    return false;
  }
}

export default supabase;
