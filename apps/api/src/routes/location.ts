import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  locationInputSchema,
  locationToolReplyParamsSchema,
  locationToolReplySchema,
} from '@voice/contracts'
import type { LocationService } from '@voice/database'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import type { ApiEnv } from '../http/types.js'
import type { VoiceSessionManager } from '../voice/session-manager.js'

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

export const locationToolReplyRoute = createRoute({
  method: 'post',
  path: '/v1/voice/sessions/{id}/location/{requestId}',
  request: {
    params: locationToolReplyParamsSchema,
    body: { ...jsonResponse(locationToolReplySchema), required: true },
  },
  responses: {
    204: { description: 'Location tool request answered' },
    404: errorResponse,
    401: errorResponse,
  },
})

export const saveLocationHandler =
  (location: LocationService): RouteHandler<typeof saveLocationRoute, ApiEnv> =>
  async (c) => {
    await location.save(c.req.valid('json'))
    return c.body(null, 204)
  }

export const locationToolReplyHandler =
  (
    voice: VoiceSessionManager,
    location: LocationService,
  ): RouteHandler<typeof locationToolReplyRoute, ApiEnv> =>
  async (c) => {
    const { id, requestId } = c.req.valid('param')
    const reply = c.req.valid('json')

    if (
      !voice.hasActiveSession(id) ||
      voice.uiEventChannel.requestId(id) !== requestId
    ) {
      return fail(c, 404, 'not_found', 'Location request not found')
    }

    if (reply.status === 'granted') {
      await location.save(reply)
    }

    voice.uiEventChannel.reply(id, requestId, reply)
    return c.body(null, 204)
  }
