import { getRedis } from '../config/redis';
import { logger } from '../config/logger';
import crypto from 'crypto';

const redis = getRedis();

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  tags?: string[]; // Tags for invalidation
  compress?: boolean; // Compress large values
}

class CacheService {
  private readonly DEFAULT_TTL = 3600; // 1 hora
  private readonly MAX_CACHE_SIZE = 1024 * 1024; // 1MB

  /**
   * Obtener valor del cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(this.prefixKey(key));
      
      if (!value) {
        return null;
      }

      // Verificar si está comprimido
      if (value.startsWith('gzip:')) {
        const decompressed = await this.decompress(value.substring(5));
        return JSON.parse(decompressed);
      }

      return JSON.parse(value);
    } catch (error) {
      logger.error({ error, key }, 'Cache get error');
      return null;
    }
  }

  /**
   * Guardar valor en cache
   */
  async set<T>(
    key: string, 
    value: T, 
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const { ttl = this.DEFAULT_TTL, tags = [], compress = false } = options;
      
      let serialized = JSON.stringify(value);
      
      // Comprimir si es muy grande o se solicita
      if (compress || serialized.length > this.MAX_CACHE_SIZE) {
        serialized = 'gzip:' + await this.compress(serialized);
      }

      const prefixedKey = this.prefixKey(key);
      
      // Guardar valor
      await redis.setex(prefixedKey, ttl, serialized);
      
      // Asociar con tags si se proporcionan
      if (tags.length > 0) {
        await this.addToTags(prefixedKey, tags, ttl);
      }

      logger.debug({ key, ttl, tags }, 'Cache set');
    } catch (error) {
      logger.error({ error, key }, 'Cache set error');
    }
  }

  /**
   * Eliminar del cache
   */
  async delete(key: string): Promise<void> {
    try {
      const prefixedKey = this.prefixKey(key);
      
      // Obtener tags asociados antes de eliminar
      const tags = await this.getKeyTags(prefixedKey);
      
      // Eliminar clave
      await redis.del(prefixedKey);
      
      // Remover de tags
      if (tags.length > 0) {
        await this.removeFromTags(prefixedKey, tags);
      }

      logger.debug({ key }, 'Cache deleted');
    } catch (error) {
      logger.error({ error, key }, 'Cache delete error');
    }
  }

  /**
   * Invalidar por tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    try {
      const keys = new Set<string>();
      
      // Obtener todas las claves asociadas a los tags
      for (const tag of tags) {
        const tagKey = this.getTagKey(tag);
        const taggedKeys = await redis.smembers(tagKey);
        taggedKeys.forEach(k => keys.add(k));
      }

      // Eliminar todas las claves
      if (keys.size > 0) {
        const pipeline = redis.pipeline();
        
        keys.forEach(key => {
          pipeline.del(key);
        });
        
        // También eliminar las referencias de tags
        tags.forEach(tag => {
          pipeline.del(this.getTagKey(tag));
        });
        
        await pipeline.exec();
      }

      logger.info({ tags, invalidatedCount: keys.size }, 'Cache invalidated by tags');
      
      return keys.size;
    } catch (error) {
      logger.error({ error, tags }, 'Cache invalidate by tags error');
      return 0;
    }
  }

  /**
   * Cache con función de carga
   */
  async remember<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    try {
      // Intentar obtener del cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Si no está en cache, obtener valor
      const value = await factory();
      
      // Guardar en cache
      await this.set(key, value, options);
      
      return value;
    } catch (error) {
      logger.error({ error, key }, 'Cache remember error');
      // En caso de error, ejecutar factory sin cache
      return factory();
    }
  }

  /**
   * Cache con lock para evitar stampede
   */
  async rememberWithLock<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions & { lockTtl?: number } = {}
  ): Promise<T> {
    const lockKey = `lock:${key}`;
    const lockTtl = options.lockTtl || 30; // 30 segundos por defecto
    
    try {
      // Intentar obtener del cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        return cached;
      }

      // Intentar adquirir lock
      const lockAcquired = await redis.set(
        lockKey,
        '1',
        'NX',
        'EX',
        lockTtl
      );

      if (lockAcquired) {
        try {
          // Ejecutar factory
          const value = await factory();
          
          // Guardar en cache
          await this.set(key, value, options);
          
          return value;
        } finally {
          // Liberar lock
          await redis.del(lockKey);
        }
      } else {
        // Si no se pudo adquirir el lock, esperar y reintentar
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.rememberWithLock(key, factory, options);
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache remember with lock error');
      return factory();
    }
  }

  /**
   * Incrementar contador
   */
  async increment(
    key: string, 
    amount: number = 1,
    ttl?: number
  ): Promise<number> {
    try {
      const prefixedKey = this.prefixKey(key);
      const result = await redis.incrby(prefixedKey, amount);
      
      if (ttl) {
        await redis.expire(prefixedKey, ttl);
      }
      
      return result;
    } catch (error) {
      logger.error({ error, key }, 'Cache increment error');
      return 0;
    }
  }

  /**
   * Decrementar contador
   */
  async decrement(
    key: string, 
    amount: number = 1,
    ttl?: number
  ): Promise<number> {
    try {
      const prefixedKey = this.prefixKey(key);
      const result = await redis.decrby(prefixedKey, amount);
      
      if (ttl) {
        await redis.expire(prefixedKey, ttl);
      }
      
      return result;
    } catch (error) {
      logger.error({ error, key }, 'Cache decrement error');
      return 0;
    }
  }

  /**
   * Cache de lista
   */
  async pushToList(
    key: string,
    values: any[],
    maxLength?: number,
    ttl?: number
  ): Promise<void> {
    try {
      const prefixedKey = this.prefixKey(key);
      const pipeline = redis.pipeline();
      
      // Agregar valores
      values.forEach(value => {
        pipeline.lpush(prefixedKey, JSON.stringify(value));
      });
      
      // Limitar longitud si se especifica
      if (maxLength) {
        pipeline.ltrim(prefixedKey, 0, maxLength - 1);
      }
      
      // Establecer TTL si se especifica
      if (ttl) {
        pipeline.expire(prefixedKey, ttl);
      }
      
      await pipeline.exec();
    } catch (error) {
      logger.error({ error, key }, 'Cache push to list error');
    }
  }

  /**
   * Obtener lista del cache
   */
  async getList<T>(
    key: string,
    start: number = 0,
    stop: number = -1
  ): Promise<T[]> {
    try {
      const prefixedKey = this.prefixKey(key);
      const values = await redis.lrange(prefixedKey, start, stop);
      
      return values.map(v => JSON.parse(v));
    } catch (error) {
      logger.error({ error, key }, 'Cache get list error');
      return [];
    }
  }

  /**
   * Cache de conjunto
   */
  async addToSet(
    key: string,
    members: any[],
    ttl?: number
  ): Promise<void> {
    try {
      const prefixedKey = this.prefixKey(key);
      const pipeline = redis.pipeline();
      
      // Agregar miembros
      members.forEach(member => {
        pipeline.sadd(prefixedKey, JSON.stringify(member));
      });
      
      // Establecer TTL si se especifica
      if (ttl) {
        pipeline.expire(prefixedKey, ttl);
      }
      
      await pipeline.exec();
    } catch (error) {
      logger.error({ error, key }, 'Cache add to set error');
    }
  }

  /**
   * Verificar si existe en conjunto
   */
  async existsInSet(key: string, member: any): Promise<boolean> {
    try {
      const prefixedKey = this.prefixKey(key);
      const exists = await redis.sismember(
        prefixedKey,
        JSON.stringify(member)
      );
      
      return exists === 1;
    } catch (error) {
      logger.error({ error, key }, 'Cache exists in set error');
      return false;
    }
  }

  /**
   * Cache con hash
   */
  async hashSet(
    key: string,
    field: string,
    value: any,
    ttl?: number
  ): Promise<void> {
    try {
      const prefixedKey = this.prefixKey(key);
      await redis.hset(prefixedKey, field, JSON.stringify(value));
      
      if (ttl) {
        await redis.expire(prefixedKey, ttl);
      }
    } catch (error) {
      logger.error({ error, key, field }, 'Cache hash set error');
    }
  }

  /**
   * Obtener campo de hash
   */
  async hashGet<T>(key: string, field: string): Promise<T | null> {
    try {
      const prefixedKey = this.prefixKey(key);
      const value = await redis.hget(prefixedKey, field);
      
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error({ error, key, field }, 'Cache hash get error');
      return null;
    }
  }

  /**
   * Obtener todos los campos de hash
   */
  async hashGetAll<T>(key: string): Promise<Record<string, T>> {
    try {
      const prefixedKey = this.prefixKey(key);
      const hash = await redis.hgetall(prefixedKey);
      
      const result: Record<string, T> = {};
      
      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value);
        } catch {
          // Si no se puede parsear, usar el valor tal cual
          result[field] = value as any;
        }
      }
      
      return result;
    } catch (error) {
      logger.error({ error, key }, 'Cache hash get all error');
      return {};
    }
  }

  /**
   * Limpiar todo el cache (usar con cuidado)
   */
  async flush(pattern?: string): Promise<void> {
    try {
      if (pattern) {
        const keys = await redis.keys(`cache:${pattern}`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
        logger.info({ pattern, count: keys.length }, 'Cache pattern flushed');
      } else {
        await redis.flushdb();
        logger.warn('Entire cache flushed');
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache flush error');
    }
  }

  /**
   * Obtener estadísticas del cache
   */
  async getStats(): Promise<{
    memoryUsage: number;
    totalKeys: number;
    hitRate: number;
    evictedKeys: number;
  }> {
    try {
      const info = await redis.info('memory');
      const stats = await redis.info('stats');
      
      // Parsear información
      const memoryUsage = parseInt(
        info.match(/used_memory:(\d+)/)?.[1] || '0'
      );
      const totalKeys = await redis.dbsize();
      
      // Calcular hit rate
      const keyspaceHits = parseInt(
        stats.match(/keyspace_hits:(\d+)/)?.[1] || '0'
      );
      const keyspaceMisses = parseInt(
        stats.match(/keyspace_misses:(\d+)/)?.[1] || '0'
      );
      const hitRate = keyspaceHits / (keyspaceHits + keyspaceMisses) || 0;
      
      const evictedKeys = parseInt(
        stats.match(/evicted_keys:(\d+)/)?.[1] || '0'
      );

      return {
        memoryUsage,
        totalKeys,
        hitRate: Math.round(hitRate * 100),
        evictedKeys
      };
    } catch (error) {
      logger.error({ error }, 'Cache get stats error');
      return {
        memoryUsage: 0,
        totalKeys: 0,
        hitRate: 0,
        evictedKeys: 0
      };
    }
  }

  // Métodos privados
  private prefixKey(key: string): string {
    return `cache:${key}`;
  }

  private getTagKey(tag: string): string {
    return `tag:${tag}`;
  }

  private async addToTags(key: string, tags: string[], ttl: number): Promise<void> {
    const pipeline = redis.pipeline();
    
    tags.forEach(tag => {
      const tagKey = this.getTagKey(tag);
      pipeline.sadd(tagKey, key);
      pipeline.expire(tagKey, ttl);
    });
    
    await pipeline.exec();
  }

  private async removeFromTags(key: string, tags: string[]): Promise<void> {
    const pipeline = redis.pipeline();
    
    tags.forEach(tag => {
      pipeline.srem(this.getTagKey(tag), key);
    });
    
    await pipeline.exec();
  }

  private async getKeyTags(key: string): Promise<string[]> {
    // En una implementación real, mantendrías un índice inverso
    // Por ahora, retornamos array vacío
    return [];
  }

  private async compress(data: string): Promise<string> {
    // Implementar compresión con zlib
    const { promisify } = require('util');
    const zlib = require('zlib');
    const gzip = promisify(zlib.gzip);
    
    const compressed = await gzip(data);
    return compressed.toString('base64');
  }

  private async decompress(data: string): Promise<string> {
    // Implementar descompresión con zlib
    const { promisify } = require('util');
    const zlib = require('zlib');
    const gunzip = promisify(zlib.gunzip);
    
    const buffer = Buffer.from(data, 'base64');
    const decompressed = await gunzip(buffer);
    return decompressed.toString();
  }

  /**
   * Generar clave de cache consistente
   */
  generateKey(...parts: any[]): string {
    const normalized = parts.map(part => {
      if (typeof part === 'object') {
        return crypto
          .createHash('md5')
          .update(JSON.stringify(part))
          .digest('hex');
      }
      return String(part);
    });
    
    return normalized.join(':');
  }

  /**
   * Cache warming
   */
  async warm(keys: Array<{ key: string; factory: () => Promise<any>; options?: CacheOptions }>): Promise<void> {
    logger.info({ count: keys.length }, 'Starting cache warming');
    
    const results = await Promise.allSettled(
      keys.map(({ key, factory, options }) =>
        this.set(key, factory(), options)
      )
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    logger.info({ successful, failed }, 'Cache warming completed');
  }
}

export const cacheService = new CacheService();
