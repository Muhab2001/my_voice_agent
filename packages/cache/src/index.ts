import type { PingReport, RemoteResource } from '@voice/resource-manager'
import { createClient } from 'redis'

type RedisClient = ReturnType<typeof createClient>

export interface Cache {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds: number): Promise<void>
  Aside<T>(
    key: string,
    ttlSeconds: number,
    load: () => T | Promise<T>,
  ): Promise<T>
}

export class RedisCache implements Cache {
  constructor(private readonly client: RedisClient) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, { EX: ttlSeconds })
  }

  async Aside<T>(
    key: string,
    ttlSeconds: number,
    load: () => T | Promise<T>,
  ): Promise<T> {
    const cached = await this.get(key)
    if (cached !== null) {
      return JSON.parse(cached) as T
    }

    const value = await load()
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new TypeError('Cache values must be JSON serializable')
    }

    void this.set(key, serialized, ttlSeconds).catch((error) => {
      console.error('Cache write failed', error)
    })
    return value
  }
}

export class RedisResource implements RemoteResource {
  constructor(
    private readonly client: RedisClient,
    private readonly pingTimeoutMs = 2000,
  ) {}

  async ping(): Promise<PingReport> {
    try {
      if (!this.client.isOpen) {
        await this.withTimeout(this.client.connect())
      }
      if (!this.client.isReady) {
        return { healthy: false, details: 'Redis is disconnected' }
      }
      await this.withTimeout(this.client.ping())
      return { healthy: true, details: 'Redis is reachable' }
    } catch (error) {
      return {
        healthy: false,
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async close(): Promise<void> {
    if (this.client.isReady) {
      await this.client.quit()
    } else if (this.client.isOpen) {
      this.client.destroy()
    }
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Redis ping timed out')),
        this.pingTimeoutMs,
      )
    })

    try {
      return await Promise.race([operation, deadline])
    } finally {
      clearTimeout(timeoutHandle)
    }
  }
}

export type RedisCacheOptions = {
  url: string
  connectTimeoutMs?: number
  pingTimeoutMs?: number
  disableOfflineQueue?: boolean
  reconnectDelayMs?: number
}

export function NewRedisCache({
  url,
  connectTimeoutMs = 5000,
  pingTimeoutMs = 2000,
  disableOfflineQueue = false,
  reconnectDelayMs,
}: RedisCacheOptions): {
  cache: RedisCache
  resource: RedisResource
} {
  const client = createClient({
    url,
    disableOfflineQueue,
    socket: {
      connectTimeout: connectTimeoutMs,
      ...(reconnectDelayMs === undefined
        ? {}
        : { reconnectStrategy: reconnectDelayMs }),
    },
  })
  client.on('error', (error) => console.error('Redis error:', error))

  return {
    cache: new RedisCache(client),
    resource: new RedisResource(client, pingTimeoutMs),
  }
}
