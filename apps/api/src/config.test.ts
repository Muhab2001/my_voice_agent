import { expect, test } from 'bun:test'
import { newDrizzleDatabase } from '@voice/database'
import { loadEnv } from './env.js'

const minimumEnv = {
  OPENAI_API_KEY: 'test-key',
  GOOGLE_MAPS_API_KEY: 'test-google-key',
  APP_PASSWORD: 'correct-password',
  JWT_SIGNING_SECRET: '12345678901234567890123456789012',
  DATABASE_URL: 'postgres://voice:voice@127.0.0.1:5432/voice',
  ALLOWED_ORIGIN: 'http://localhost:5173',
}

test('database tuning defaults can be overridden through API env', () => {
  const defaults = loadEnv(minimumEnv)
  expect(defaults.DATABASE_POOL_MAX).toBe(10)
  expect(defaults.DATABASE_POOL_MIN).toBe(0)
  expect(defaults.DATABASE_IDLE_TIMEOUT_MS).toBe(10_000)
  expect(defaults.DATABASE_CONNECTION_TIMEOUT_MS).toBe(3000)
  expect(defaults.DATABASE_QUERY_TIMEOUT_MS).toBe(3000)
  expect(defaults.DATABASE_MAX_LIFETIME_SECONDS).toBe(0)

  const tuned = loadEnv({
    ...minimumEnv,
    DATABASE_POOL_MAX: '20',
    DATABASE_POOL_MIN: '2',
  })
  expect(tuned.DATABASE_POOL_MAX).toBe(20)
  expect(tuned.DATABASE_POOL_MIN).toBe(2)
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
