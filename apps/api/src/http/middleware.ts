import { randomUUID } from 'node:crypto'
import type { MiddlewareHandler } from 'hono'
import { fail } from './responses.js'
import type { ApiEnv } from './types.js'

export const requestId: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const id = randomUUID()
  c.set('requestId', id)
  c.header('X-Request-Id', id)
  await next()
}

export const requireAllowedOrigin =
  (allowedOrigin: string): MiddlewareHandler<ApiEnv> =>
  async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && origin !== allowedOrigin) {
      return fail(c, 403, 'forbidden_origin', 'Origin is not allowed')
    }
    await next()
  }
