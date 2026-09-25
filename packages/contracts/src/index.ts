import { z } from '@hono/zod-openapi'

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi('ApiError')

export const authResponseSchema = z
  .object({
    accessToken: z.string(),
    expiresAt: z.string().datetime(),
  })
  .openapi('AuthResponse')

export const loginSchema = z
  .object({
    password: z.string().min(1).max(1024),
  })
  .openapi('LoginRequest')

export const healthSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']),
  })
  .openapi('HealthResponse')

export const readinessSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']),
    resources: z.record(z.string()),
  })
  .openapi('ReadinessResponse')
