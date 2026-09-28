import type { Hook } from '@hono/zod-openapi'
import { errorSchema } from '@voice/contracts'
import type { Context, ErrorHandler, NotFoundHandler } from 'hono'
import type { ApiEnv } from './types.js'

export const jsonResponse = <T>(schema: T) => ({
  content: { 'application/json': { schema } },
  description: 'JSON response',
})

export const errorResponse = jsonResponse(errorSchema)

export const invalidRequestHook: Hook<
  unknown,
  ApiEnv,
  string,
  Response | undefined
> = (result, c) => {
  if (!result.success) {
    return fail(c, 400, 'invalid_request', 'Invalid request body')
  }
}

export function fail<S extends 400 | 401 | 403 | 404 | 503>(
  c: Context<ApiEnv>,
  status: S,
  code: string,
  message: string,
) {
  return c.json(
    { error: { code, message, requestId: c.get('requestId') } },
    status,
  )
}

export const errorHandler: ErrorHandler<ApiEnv> = (error, c) => {
  console.error('Request failed', {
    requestId: c.get('requestId'),
    error: error.message,
  })
  return c.json(
    {
      error: {
        code: 'internal_error',
        message: 'Internal server error',
        requestId: c.get('requestId'),
      },
    },
    500,
  )
}

export const notFoundHandler: NotFoundHandler<ApiEnv> = (c) =>
  c.json(
    {
      error: {
        code: 'not_found',
        message: 'Route not found',
        requestId: c.get('requestId'),
      },
    },
    404,
  )
