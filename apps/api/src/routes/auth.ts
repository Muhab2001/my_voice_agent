import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import type { AuthService } from '@voice/auth'
import { authResponseSchema, loginSchema } from '@voice/contracts'
import { getCookie, setCookie } from 'hono/cookie'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import type { ApiEnv } from '../http/types.js'

const refreshCookie = 'voice_refresh'

export type CookiePolicy = {
  secure: boolean
}

function cookieOptions(policy: CookiePolicy) {
  return {
    httpOnly: true as const,
    secure: policy.secure,
    sameSite: policy.secure ? ('None' as const) : ('Lax' as const),
    path: '/v1/auth',
  }
}

export const loginRoute = createRoute({
  method: 'post',
  path: '/v1/auth/login',
  request: { body: jsonResponse(loginSchema) },
  responses: {
    200: jsonResponse(authResponseSchema),
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
  },
})

export const refreshRoute = createRoute({
  method: 'post',
  path: '/v1/auth/refresh',
  responses: {
    200: jsonResponse(authResponseSchema),
    401: errorResponse,
    403: errorResponse,
  },
})

export const logoutRoute = createRoute({
  method: 'post',
  path: '/v1/auth/logout',
  responses: { 204: { description: 'Cookie cleared' }, 403: errorResponse },
})

export const loginHandler =
  (
    auth: AuthService,
    policy: CookiePolicy,
  ): RouteHandler<typeof loginRoute, ApiEnv> =>
  async (c) => {
    const { password } = c.req.valid('json')
    if (!auth.checkPassword(password)) {
      return fail(c, 401, 'invalid_credentials', 'Invalid credentials')
    }

    const [access, refresh] = await Promise.all([
      auth.issueAccess(),
      auth.issueRefresh(),
    ])
    setCookie(c, refreshCookie, refresh, {
      ...cookieOptions(policy),
      maxAge: 7 * 24 * 60 * 60,
    })
    return c.json(access, 200)
  }

export const refreshHandler =
  (auth: AuthService): RouteHandler<typeof refreshRoute, ApiEnv> =>
  async (c) => {
    const token = getCookie(c, refreshCookie)
    if (!token) {
      return fail(c, 401, 'unauthorized', 'Invalid refresh token')
    }

    try {
      await auth.verifyRefresh(token)
    } catch {
      return fail(c, 401, 'unauthorized', 'Invalid refresh token')
    }

    return c.json(await auth.issueAccess(), 200)
  }

export const logoutHandler =
  (policy: CookiePolicy): RouteHandler<typeof logoutRoute, ApiEnv> =>
  (c) => {
    setCookie(c, refreshCookie, '', { ...cookieOptions(policy), maxAge: 0 })
    return c.body(null, 204)
  }
