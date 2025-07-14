import dotenv from 'dotenv';
dotenv.config();

import app from './app';

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = '0.0.0.0';

// Log environment for debugging
console.log('🔧 Starting ForvaraCore server...');
console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔌 Port: ${PORT}`);
console.log(`🌐 Host: ${HOST}`);
console.log(`🔑 Environment variables loaded:`, {
  SUPABASE_URL: !!process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
  JWT_SECRET: !!process.env.JWT_SECRET,
  STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
});

// Start server with error handling
try {
  const server = app.listen(PORT, HOST, () => {
    console.log(`✅ ForvaraCore server successfully started!`);
    console.log(`🚀 Server running on ${HOST}:${PORT}`);
    console.log(`📡 API available at http://${HOST}:${PORT}/api`);
    console.log(`🏥 Health check at http://${HOST}:${PORT}/api/health`);
    console.log(`⏰ Server started at: ${new Date().toISOString()}`);
  });

  // Handle server errors
  server.on('error', (err: any) => {
    console.error('❌ Server error:', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use`);
    } else if (err.code === 'EACCES') {
      console.error(`No permission to bind to port ${PORT}`);
    }
    process.exit(1);
  });
} catch (err) {
  console.error('❌ Failed to start server:', err);
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
