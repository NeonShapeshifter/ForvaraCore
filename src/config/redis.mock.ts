// Mock Redis implementation for development without Docker
import { EventEmitter } from 'events'

class MockRedis extends EventEmitter {
  private store: Map<string, string> = new Map()
  private hashStore: Map<string, Map<string, string>> = new Map()
  private listStore: Map<string, string[]> = new Map()
  private ttls: Map<string, number> = new Map()

  async get(key: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.del(key)
      return null
    }
    return this.store.get(key) || null
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
    this.store.set(key, value)
    if (mode === 'EX' && duration) {
      this.ttls.set(key, Date.now() + duration * 1000)
    }
    return 'OK'
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    this.store.set(key, value)
    this.ttls.set(key, Date.now() + seconds * 1000)
    return 'OK'
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key)
    this.store.delete(key)
    this.hashStore.delete(key)
    this.listStore.delete(key)
    this.ttls.delete(key)
    return existed ? 1 : 0
  }

  async exists(key: string): Promise<number> {
    if (this.isExpired(key)) {
      this.del(key)
      return 0
    }
    return this.store.has(key) ? 1 : 0
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.store.has(key)) {
      this.ttls.set(key, Date.now() + seconds * 1000)
      return 1
    }
    return 0
  }

  // Hash operations
  async hget(key: string, field: string): Promise<string | null> {
    if (this.isExpired(key)) {
      this.del(key)
      return null
    }
    return this.hashStore.get(key)?.get(field) || null
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.hashStore.has(key)) {
      this.hashStore.set(key, new Map())
    }
    const hash = this.hashStore.get(key)!
    const isNew = !hash.has(field)
    hash.set(field, value)
    return isNew ? 1 : 0
  }

  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    if (this.isExpired(key)) {
      this.del(key)
      return fields.map(() => null)
    }
    const hash = this.hashStore.get(key)
    return fields.map(field => hash?.get(field) || null)
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    const current = parseInt(await this.hget(key, field) || '0')
    const newValue = current + increment
    await this.hset(key, field, newValue.toString())
    return newValue
  }

  // List operations
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.listStore.has(key)) {
      this.listStore.set(key, [])
    }
    const list = this.listStore.get(key)!
    list.unshift(...values.reverse())
    return list.length
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (this.isExpired(key)) {
      this.del(key)
      return []
    }
    const list = this.listStore.get(key) || []
    const end = stop === -1 ? list.length : stop + 1
    return list.slice(start, end)
  }

  async ltrim(key: string, start: number, stop: number): Promise<'OK'> {
    const list = this.listStore.get(key)
    if (list) {
      const end = stop === -1 ? list.length : stop + 1
      const trimmed = list.slice(start, end)
      this.listStore.set(key, trimmed)
    }
    return 'OK'
  }

  // Stream operations (simplified)
  async xadd(key: string, id: string, ...fieldValues: string[]): Promise<string> {
    const timestamp = id === '*' ? Date.now().toString() : id
    // For mock purposes, just store as a list entry
    const entry = JSON.stringify({ id: timestamp, data: fieldValues })
    await this.lpush(key, entry)
    return timestamp
  }

  private isExpired(key: string): boolean {
    const ttl = this.ttls.get(key)
    return ttl ? Date.now() > ttl : false
  }

  // Connection methods
  connect(): Promise<void> {
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    return Promise.resolve()
  }

  ping(): Promise<'PONG'> {
    return Promise.resolve('PONG')
  }
}

let redisClient: MockRedis | null = null

export function createMockRedis(): MockRedis {
  return new MockRedis()
}

export async function connectRedis(): Promise<MockRedis> {
  if (!redisClient) {
    redisClient = createMockRedis()
    console.log('✅ Mock Redis connected for development')
  }
  return redisClient
}

export function getRedis(): MockRedis {
  if (!redisClient) {
    // Auto-inicializar para desarrollo
    redisClient = new MockRedis()
  }
  return redisClient
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.disconnect()
    redisClient = null
    console.log('✅ Mock Redis disconnected')
  }
}