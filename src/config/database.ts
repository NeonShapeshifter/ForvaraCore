import { createClient } from '@supabase/supabase-js';

// Ensure environment variables are loaded
if (!process.env.SUPABASE_URL) {
  require('dotenv').config();
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Enhanced error handling for Railway deployment
if (!supabaseUrl) {
  console.error('❌ SUPABASE_URL environment variable is missing');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('SUPABASE')));
  throw new Error('SUPABASE_URL is required');
}

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_KEY environment variable is missing');
  console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('SUPABASE')));
  throw new Error('SUPABASE_SERVICE_KEY is required');
}

console.log('✅ Supabase configuration loaded successfully');
console.log(`📡 Connecting to: ${supabaseUrl}`);

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    headers: {
      'User-Agent': 'ForvaraCore/3.0.0'
    }
  }
});

// Lazy connection test - don't block server startup
export async function testDatabaseConnection() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
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
