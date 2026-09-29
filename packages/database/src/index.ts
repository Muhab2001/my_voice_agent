import type { PingReport, RemoteResource } from '@voice/resource-manager'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'

export type DrizzleClient = ReturnType<typeof drizzle>

export class DrizzleResource implements RemoteResource {
  constructor(private readonly pool: pg.Pool) {}

  async ping(): Promise<PingReport> {
    try {
      await this.pool.query('select 1')
      return { healthy: true, details: 'PostgreSQL is reachable' }
    } catch (error) {
      return {
        healthy: false,
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

export type DrizzleDatabaseOptions = {
  url: string
  poolMax?: number
  poolMin?: number
  idleTimeoutMs?: number
  connectionTimeoutMs?: number
  queryTimeoutMs?: number
  maxLifetimeSeconds?: number
}

export function newDrizzleDatabase({
  url,
  poolMax = 10,
  poolMin = 0,
  idleTimeoutMs = 10_000,
  connectionTimeoutMs = 3000,
  queryTimeoutMs = 3000,
  maxLifetimeSeconds = 0,
}: DrizzleDatabaseOptions): {
  client: DrizzleClient
  resource: DrizzleResource
} {
  if (poolMin > poolMax) {
    throw new RangeError('Database pool minimum cannot exceed maximum')
  }

  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    min: poolMin,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: queryTimeoutMs,
    maxLifetimeSeconds,
  })

  return { client: drizzle(pool), resource: new DrizzleResource(pool) }
}

export * from './location-service.js'
export * from './memory-service.js'
export * from './reservation-service.js'
export { DEFAULT_LIVE_MODEL } from './schema.js'
export * from './transcript-service.js'
export * from './voice-session-service.js'
