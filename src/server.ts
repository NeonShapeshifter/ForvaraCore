import 'dotenv/config';
import http from 'http';
// Removed SocketServer import - handled in websocket service
import app from './app';
import { config } from './config';
import { logger } from './config/logger';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { setupQueues } from './queues';
import { setupWebSockets } from './services/websocket.service';
import { gracefulShutdown } from './utils/shutdown';

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection');
  process.exit(1);
});

async function startServer() {
  try {
    // Verificar variables de entorno críticas
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_KEY',
      'JWT_SECRET'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    // Conectar servicios
    logger.info('🔌 Connecting to services...');
    
    await connectDatabase();
    logger.info('✅ Database connected');
    
    await connectRedis();
    logger.info('✅ Redis connected');
    
    // Setup queues
    await setupQueues();
    logger.info('✅ Queues initialized');

    // Crear servidor HTTP
    const server = http.createServer(app);

    // Setup WebSockets si está habilitado
    if (config.ENABLE_WEBSOCKETS) {
      setupWebSockets(server);
      logger.info('✅ WebSockets initialized');
    }

    // Iniciar servidor
    server.listen(config.PORT, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════════╗
║                    🚀 FORVARA CORE API v2.0.0               ║
╠══════════════════════════════════════════════════════════════╣
║ 📍 Environment: ${config.NODE_ENV.padEnd(43)} ║
║ 🔐 Auth: Supabase + JWT + Redis Sessions                   ║
║ 💾 Database: PostgreSQL via Supabase                       ║
║ 🏪 Cache: Redis                                           ║
║ 📁 Storage: ${config.STORAGE_BUCKET.padEnd(47)} ║
║ 🔄 WebSockets: ${config.ENABLE_WEBSOCKETS ? 'Enabled' : 'Disabled'}${' '.repeat(36)} ║
║ 📚 API Docs: http://localhost:${config.PORT}/api-docs${' '.repeat(22)} ║
║ 📊 Health: http://localhost:${config.PORT}/health${' '.repeat(25)} ║
║ 🏃 Server: http://localhost:${config.PORT}${' '.repeat(31)} ║
╚══════════════════════════════════════════════════════════════╝

🎮 Ready to revolutionize enterprise software!
      `);
    });

    // Setup graceful shutdown
    gracefulShutdown(server);

  } catch (error) {
    logger.fatal({ error }, '❌ Failed to start server');
    process.exit(1);
  }
}

// Iniciar servidor
startServer();
