import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  transcriptResponseSchema,
  voiceAnswerSchema,
  voiceIdSchema,
  voiceOfferSchema,
  voiceStatusSchema,
} from '@voice/contracts'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import type { ApiEnv } from '../http/types.js'
import type { VoiceSessionManager } from '../voice/session-manager.js'

export const createVoiceRoute = createRoute({
  method: 'post',
  path: '/v1/voice/sessions',
  request: { body: { ...jsonResponse(voiceOfferSchema), required: true } },
  responses: {
    201: jsonResponse(voiceAnswerSchema),
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    503: errorResponse,
  },
})

export const endVoiceRoute = createRoute({
  method: 'post',
  path: '/v1/voice/sessions/{id}/end',
  request: { params: voiceIdSchema },
  responses: {
    204: { description: 'Session ended' },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
  },
})

export const voiceStatusRoute = createRoute({
  method: 'get',
  path: '/v1/voice/sessions/{id}',
  request: { params: voiceIdSchema },
  responses: {
    200: jsonResponse(voiceStatusSchema),
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
  },
})

export const transcriptsRoute = createRoute({
  method: 'get',
  path: '/v1/voice/sessions/{id}/transcripts',
  request: { params: voiceIdSchema },
  responses: {
    200: jsonResponse(transcriptResponseSchema),
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
  },
})

export const createVoiceHandler =
  (
    manager: VoiceSessionManager,
    isShuttingDown: () => boolean,
  ): RouteHandler<typeof createVoiceRoute, ApiEnv> =>
  async (c) => {
    if (isShuttingDown()) {
      return fail(c, 503, 'voice_unavailable', 'Voice service is unavailable')
    }
    try {
      return c.json(await manager.create(c.req.valid('json').sdp), 201)
    } catch {
      return fail(
        c,
        503,
        'voice_setup_failed',
        'Could not establish the voice session. Please try again.',
      )
    }
  }

export const endVoiceHandler =
  (manager: VoiceSessionManager): RouteHandler<typeof endVoiceRoute, ApiEnv> =>
  async (c) => {
    await manager.end(c.req.valid('param').id)
    return c.body(null, 204)
  }

export const voiceStatusHandler =
  (
    manager: VoiceSessionManager,
  ): RouteHandler<typeof voiceStatusRoute, ApiEnv> =>
  async (c) => {
    const status = await manager.status(c.req.valid('param').id)
    if (!status) {
      return fail(c, 404, 'not_found', 'Session not found')
    }
    return c.json(status, 200)
  }

export const transcriptsHandler =
  (
    manager: VoiceSessionManager,
  ): RouteHandler<typeof transcriptsRoute, ApiEnv> =>
  async (c) => {
    const id = c.req.valid('param').id
    if (!(await manager.status(id))) {
      return fail(c, 404, 'not_found', 'Session not found')
    }
    const rows = await manager.transcripts(id)
    return c.json(
      {
        snapshots: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      },
      200,
    )
  }
