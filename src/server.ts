import dotenv from 'dotenv';
import { Server } from 'http';
dotenv.config();

import app from './app';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = '0.0.0.0';

// RAILWAY DEBUGGING - Enhanced startup logging
console.log('🚀 =================== FORVARA CORE STARTUP ===================');
console.log(`⏰ Startup Time: ${new Date().toISOString()}`);
console.log(`🔧 Starting ForvaraCore server...`);
console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${PORT} (parsed from: "${process.env.PORT || '4000'}")`);
console.log(`🌐 Host: ${HOST}`);
console.log(`🐳 Railway Environment: ${process.env.RAILWAY_ENVIRONMENT || 'not detected'}`);
console.log(`📡 Railway Public Domain: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'not set'}`);
console.log(`🌍 Railway Project: ${process.env.RAILWAY_PROJECT_NAME || 'not set'}`);

// Detailed environment check
console.log(`🔑 Environment Variables Status:`);
console.log(`  - NODE_ENV: ${process.env.NODE_ENV || 'undefined'}`);
console.log(`  - PORT: ${process.env.PORT || 'undefined'}`);
console.log(`  - SUPABASE_URL: ${process.env.SUPABASE_URL ? '✅ SET' : '❌ MISSING'}`);
console.log(`  - SUPABASE_SERVICE_KEY: ${process.env.SUPABASE_SERVICE_KEY ? '✅ SET' : '❌ MISSING'}`);
console.log(`  - JWT_SECRET: ${process.env.JWT_SECRET ? '✅ SET' : '❌ MISSING'}`);
console.log(`  - STRIPE_SECRET_KEY: ${process.env.STRIPE_SECRET_KEY ? '✅ SET' : '❌ MISSING'}`);
console.log(`  - ALLOWED_ORIGINS: ${process.env.ALLOWED_ORIGINS || 'undefined'}`);

// Process info
console.log(`🔧 Process Info:`);
console.log(`  - Node Version: ${process.version}`);
console.log(`  - Platform: ${process.platform}`);
console.log(`  - Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
console.log(`  - CWD: ${process.cwd()}`);

console.log('===============================================================');

// Environment validation for Railway
const validateEnvironment = () => {
  const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('🚨 ================= ENVIRONMENT ERROR =================');
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('====================================================');
    
    // In Railway, don't exit but continue with limited functionality
    if (process.env.RAILWAY_ENVIRONMENT) {
      console.warn('⚠️  Continuing in Railway environment with missing variables...');
      return false;
    } else {
      process.exit(1);
    }
  }
  
  console.log('✅ All required environment variables are present');
  return true;
};

// Validate environment before starting server
const envValid = validateEnvironment();

// Declare server variable outside try block for proper scope
let server: Server;

// Start server with enhanced Railway debugging
try {
  console.log(`🔄 Attempting to bind server to ${HOST}:${PORT}...`);
  
  server = app.listen(PORT, HOST, () => {
    console.log('🎉 ================== SERVER STARTED SUCCESSFULLY ==================');
    console.log(`✅ ForvaraCore server successfully started!`);
    console.log(`🚀 Server running on ${HOST}:${PORT}`);
    console.log(`📡 API available at http://${HOST}:${PORT}/api`);
    console.log(`🏥 Health check at http://${HOST}:${PORT}/api/health`);
    console.log(`🌐 Railway health check should use: /api/health`);
    console.log(`⏰ Server started at: ${new Date().toISOString()}`);
    console.log(`🔗 Network interfaces:`);
    
    // Log network interfaces
    const os = require('os');
    const interfaces = os.networkInterfaces();
    Object.keys(interfaces).forEach(name => {
      interfaces[name].forEach((iface: any) => {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`  - ${name}: ${iface.address}`);
        }
      });
    });
    
    console.log('================================================================');
    
    // Test health endpoint immediately after startup
    setTimeout(() => {
      console.log('🔄 Testing health endpoint after startup...');
      const http = require('http');
      const healthReq = http.request({
        hostname: 'localhost',
        port: PORT,
        path: '/api/health',
        method: 'GET',
        timeout: 5000
      }, (res: any) => {
        console.log(`✅ Self health check: ${res.statusCode}`);
        let data = '';
        res.on('data', (chunk: any) => data += chunk);
        res.on('end', () => {
          console.log('📊 Health response:', data.substring(0, 200));
        });
      });
      
      healthReq.on('error', (err: any) => {
        console.error('❌ Self health check failed:', err.message);
      });
      
      healthReq.end();
    }, 1000);
  });

  // Enhanced server error handling
  server.on('error', (err: any) => {
    console.error('🚨 ================== SERVER ERROR ==================');
    console.error('❌ Server error:', err);
    console.error(`❌ Error code: ${err.code}`);
    console.error(`❌ Error message: ${err.message}`);
    
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use - Railway should handle port allocation`);
    } else if (err.code === 'EACCES') {
      console.error(`❌ No permission to bind to port ${PORT} - check Railway permissions`);
    } else if (err.code === 'ENOTFOUND') {
      console.error(`❌ Host ${HOST} not found - Railway networking issue`);
    }
    
    console.error('====================================================');
    process.exit(1);
  });

  // Additional event listeners for debugging
  server.on('listening', () => {
    console.log('🎯 Server "listening" event fired - Railway should detect this');
  });

  server.on('connection', (socket) => {
    console.log('🔌 New connection established');
  });

} catch (err) {
  console.error('🚨 ================= STARTUP FAILURE =================');
  console.error('❌ Failed to start server:', err);
  console.error('❌ Stack trace:', (err as Error).stack);
  console.error('====================================================');
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');  
  server.close(() => {
    console.log('Process terminated');
  });
});

export default server;
