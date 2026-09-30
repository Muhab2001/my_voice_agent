import { randomUUID } from 'node:crypto'
import type { AuthService } from '@voice/auth'
import type { MiddlewareHandler } from 'hono'
import type { ApiEnv } from '../app.js'
import { fail } from './responses.js'

export const requestId: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const id = randomUUID()
  c.set('requestId', id)
  c.header('X-Request-Id', id)
  await next()
}

export const AllowedOrigin =
  (allowedOrigin: string): MiddlewareHandler<ApiEnv> =>
  async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && origin !== allowedOrigin) {
      return fail(c, 403, 'forbidden_origin', 'Origin is not allowed')
    }
    await next()
  }

export const Authenticated =
  (auth: AuthService): MiddlewareHandler<ApiEnv> =>
  async (c, next) => {
    const header = c.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) {
      return fail(c, 401, 'unauthorized', 'Access token required')
    }
    try {
      await auth.verifyAccess(header.slice(7))
    } catch {
      return fail(c, 401, 'unauthorized', 'Invalid access token')
    }
    await next()
  }
