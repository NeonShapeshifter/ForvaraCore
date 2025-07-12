import Redis from 'ioredis';
import { config } from './index';
import { logger } from './logger';
import { connectRedis as connectMockRedis, getRedis as getMockRedis } from './redis.mock';

let redis: Redis | any;
let subscriber: Redis | any;
let publisher: Redis | any;
let useMockRedis = false;

export const connectRedis = async (): Promise<void> => {
  try {
    // Intentar conectar a Redis real primero
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      retryStrategy: () => null, // No retry, fallback to mock
    });

    // Test connection
    await redis.ping();
    
    // Cliente para pub/sub
    subscriber = redis.duplicate();
    publisher = redis.duplicate();

    // Event handlers
    redis.on('connect', () => {
      logger.info('✅ Redis connected');
    });

    redis.on('error', (error) => {
      logger.error({ error }, 'Redis error');
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    // Test connection
    await redis.ping();
    
  } catch (error) {
    logger.warn({ error }, '⚠️ Redis connection failed, using mock Redis for development');
    
    // Fallback to mock Redis
    useMockRedis = true;
    redis = await connectMockRedis();
    subscriber = redis;
    publisher = redis;
  }
};

export const getRedis = (): Redis | any => {
  if (!redis) {
    // Auto-inicializar mock Redis para desarrollo
    logger.warn('Auto-initializing mock Redis for development');
    useMockRedis = true;
    redis = getMockRedis();
    subscriber = redis;
    publisher = redis;
  }
  return redis;
};

export const getSubscriber = (): Redis => subscriber;
export const getPublisher = (): Redis => publisher;

// Cache helpers
export class CacheService {
  private prefix: string;
  private ttl: number;

  constructor(prefix: string, ttl: number = config.REDIS_TTL) {
    this.prefix = `forvara:${prefix}`;
    this.ttl = ttl;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(`${this.prefix}:${key}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error({ error, key }, 'Cache get error');
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      await redis.setex(
        `${this.prefix}:${key}`,
        ttl || this.ttl,
        JSON.stringify(value)
      );
    } catch (error) {
      logger.error({ error, key }, 'Cache set error');
    }
  }

  async del(key: string): Promise<void> {
    try {
      await redis.del(`${this.prefix}:${key}`);
    } catch (error) {
      logger.error({ error, key }, 'Cache delete error');
    }
  }

  async flush(): Promise<void> {
    try {
      const keys = await redis.keys(`${this.prefix}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error({ error }, 'Cache flush error');
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await redis.keys(`${this.prefix}:${pattern}`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache invalidate pattern error');
    }
  }
}

// Session store
export class SessionStore {
  private prefix = 'session';
  private ttl = 7 * 24 * 60 * 60; // 7 días

  async get(sessionId: string): Promise<any | null> {
    const data = await redis.get(`${this.prefix}:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  async set(sessionId: string, data: any, ttl?: number): Promise<void> {
    await redis.setex(
      `${this.prefix}:${sessionId}`,
      ttl || this.ttl,
      JSON.stringify(data)
    );
  }

  async destroy(sessionId: string): Promise<void> {
    await redis.del(`${this.prefix}:${sessionId}`);
  }

  async touch(sessionId: string): Promise<void> {
    await redis.expire(`${this.prefix}:${sessionId}`, this.ttl);
  }
}

// Rate limiter store
export class RateLimiterStore {
  async increment(key: string, windowMs: number): Promise<number> {
    const multi = redis.multi();
    const redisKey = `rate:${key}`;
    
    multi.incr(redisKey);
    multi.expire(redisKey, Math.ceil(windowMs / 1000));
    
    const results = await multi.exec();
    return results?.[0]?.[1] as number || 1;
  }

  async reset(key: string): Promise<void> {
    await redis.del(`rate:${key}`);
  }
}

export { redis };
