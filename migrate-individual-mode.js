const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function runMigration() {
  console.log('🔄 Running Individual Mode Migration...');
  
  try {
    // Read migration file
    const migrationPath = path.join(__dirname, 'sql', '03_individual_mode_migration.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split into individual statements
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📋 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`🔨 Executing statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + '...');
      
      const { error } = await supabase.rpc('execute_sql', {
        query: statement
      });
      
      if (error) {
        console.error(`❌ Error in statement ${i + 1}:`, error);
        throw error;
      }
      
      console.log(`✅ Statement ${i + 1} completed`);
    }
    
    console.log('🎉 Individual Mode Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('💡 You may need to run this migration manually in Supabase SQL Editor');
    process.exit(1);
  }
}

runMigration();