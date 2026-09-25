import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export function loadEnv(runtimeEnv: NodeJS.ProcessEnv = process.env) {
  return createEnv({
    server: {
      APP_PASSWORD: z.string().min(12),
      JWT_SIGNING_SECRET: z.string().min(32),
      DATABASE_URL: z.string().url(),
      DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
      DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(0),
      DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
      DATABASE_CONNECTION_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(0)
        .default(3000),
      DATABASE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(0).default(3000),
      DATABASE_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(0).default(0),
      REDIS_URL: z.string().url(),
      REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1).default(5000),
      REDIS_PING_TIMEOUT_MS: z.coerce.number().int().min(1).default(2000),
      REDIS_DISABLE_OFFLINE_QUEUE: z.enum(['true', 'false']).default('false'),
      REDIS_RECONNECT_DELAY_MS: z.coerce.number().int().min(0).optional(),
      ALLOWED_ORIGIN: z.string().url(),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
    },
    runtimeEnv,
    emptyStringAsUndefined: true,
  })
}
