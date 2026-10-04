import type { AuthService } from '@voice/auth'
import { authResponseSchema } from '@voice/contracts'
import { getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import { route } from '../http/route.js'

const refreshCookie = 'voice_refresh'

type CookiePolicy = {
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

// Exchanges the operator password for an access token and refresh cookie.
export const loginRoute = (auth: AuthService, policy: CookiePolicy) =>
  route(
    {
      method: 'post',
      path: '/v1/auth/login',
      request: {
        body: jsonResponse(
          z
            .object({ password: z.string().min(1).max(1024) })
            .openapi('LoginRequest'),
        ),
      },
      responses: {
        200: jsonResponse(authResponseSchema),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
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
    },
  )

// Issues a new access token from the refresh cookie.
export const refreshRoute = (auth: AuthService) =>
  route(
    {
      method: 'post',
      path: '/v1/auth/refresh',
      responses: {
        200: jsonResponse(authResponseSchema),
        401: errorResponse,
        403: errorResponse,
      },
    },
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
    },
  )

// Clears the browser's refresh cookie.
export const logoutRoute = (policy: CookiePolicy) =>
  route(
    {
      method: 'post',
      path: '/v1/auth/logout',
      responses: { 204: { description: 'Cookie cleared' }, 403: errorResponse },
    },
    (c) => {
      setCookie(c, refreshCookie, '', { ...cookieOptions(policy), maxAge: 0 })
      return c.body(null, 204)
    },
  )
