import { Server } from 'http';
import { logger } from '@config/logger';
import { redis } from '@config/redis';
import { closeQueues } from '../queues';

export async function gracefulShutdown(server: Server): Promise<void> {
  logger.info('SIGTERM signal received: closing HTTP server');
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Close Redis connection
      await redis.quit();
      logger.info('Redis connection closed');
      
      // Close queues
      await closeQueues();
      logger.info('Queues closed');
      
      // Close database connections (Supabase handles this automatically)
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
}