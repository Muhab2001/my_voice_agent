import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import { locationInputSchema } from '@voice/contracts'
import type { LocationService } from '@voice/database'
import type { ApiEnv } from '../app.js'
import { errorResponse, jsonResponse } from '../http/responses.js'

export const saveLocationRoute = createRoute({
  method: 'post',
  path: '/v1/location',
  request: { body: { ...jsonResponse(locationInputSchema), required: true } },
  responses: {
    204: { description: 'Position saved' },
    400: errorResponse,
    401: errorResponse,
  },
})

export const saveLocationHandler =
  (location: LocationService): RouteHandler<typeof saveLocationRoute, ApiEnv> =>
  async (c) => {
    await location.save(c.req.valid('json'))
    return c.body(null, 204)
  }
