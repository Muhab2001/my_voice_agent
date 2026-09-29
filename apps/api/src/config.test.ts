import { expect, test } from 'bun:test'
import { RedisResource } from '@voice/cache'
import { newDrizzleDatabase } from '@voice/database'
import { loadEnv } from './env.js'

const minimumEnv = {
  OPENAI_API_KEY: 'test-key',
  GOOGLE_MAPS_API_KEY: 'test-google-key',
  APP_PASSWORD: 'correct-password',
  JWT_SIGNING_SECRET: '12345678901234567890123456789012',
  DATABASE_URL: 'postgres://voice:voice@127.0.0.1:5432/voice',
  REDIS_URL: 'redis://127.0.0.1:6379',
  ALLOWED_ORIGIN: 'http://localhost:5173',
}

test('database and Redis tuning defaults can be overridden through API env', () => {
  const defaults = loadEnv(minimumEnv)
  expect(defaults.DATABASE_POOL_MAX).toBe(10)
  expect(defaults.DATABASE_POOL_MIN).toBe(0)
  expect(defaults.DATABASE_IDLE_TIMEOUT_MS).toBe(10_000)
  expect(defaults.DATABASE_CONNECTION_TIMEOUT_MS).toBe(3000)
  expect(defaults.DATABASE_QUERY_TIMEOUT_MS).toBe(3000)
  expect(defaults.DATABASE_MAX_LIFETIME_SECONDS).toBe(0)
  expect(defaults.REDIS_CONNECT_TIMEOUT_MS).toBe(5000)
  expect(defaults.REDIS_PING_TIMEOUT_MS).toBe(2000)
  expect(defaults.REDIS_DISABLE_OFFLINE_QUEUE).toBe('false')
  expect(defaults.REDIS_RECONNECT_DELAY_MS).toBeUndefined()

  const tuned = loadEnv({
    ...minimumEnv,
    DATABASE_POOL_MAX: '20',
    DATABASE_POOL_MIN: '2',
    REDIS_PING_TIMEOUT_MS: '1500',
    REDIS_RECONNECT_DELAY_MS: '250',
  })
  expect(tuned.DATABASE_POOL_MAX).toBe(20)
  expect(tuned.DATABASE_POOL_MIN).toBe(2)
  expect(tuned.REDIS_PING_TIMEOUT_MS).toBe(1500)
  expect(tuned.REDIS_RECONNECT_DELAY_MS).toBe(250)
})

test('Drizzle factory returns the client and resource together', async () => {
  const database = newDrizzleDatabase({ url: minimumEnv.DATABASE_URL })
  expect(database.client).toBeDefined()
  expect(database.resource).toBeDefined()
  await database.resource.close()

  expect(() =>
    newDrizzleDatabase({
      url: minimumEnv.DATABASE_URL,
      poolMax: 1,
      poolMin: 2,
    }),
  ).toThrow()
})

test('Redis ping timeout is configurable', async () => {
  const client = {
    isOpen: true,
    isReady: true,
    ping: () => new Promise<string>(() => {}),
  } as unknown as ConstructorParameters<typeof RedisResource>[0]
  const resource = new RedisResource(client, 10)
  expect(await resource.ping()).toEqual({
    healthy: false,
    details: 'Redis ping timed out',
  })
})
