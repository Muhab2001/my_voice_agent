import { voiceAnswerSchema, voiceStatusSchema } from '@voice/contracts'
import { z } from 'zod'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import { route } from '../http/route.js'
import type { VoiceSessionManager } from '../voice/session-manager.js'

// Creates a voice session from the browser's WebRTC offer.
export const createVoiceSessionRoute = (
  manager: VoiceSessionManager,
  isShuttingDown: () => boolean,
) =>
  route(
    {
      method: 'post',
      path: '/v1/voice/sessions',
      request: {
        body: {
          ...jsonResponse(
            z
              .object({ sdp: z.string().min(1).max(100_000) })
              .openapi('VoiceOffer'),
          ),
          required: true,
        },
      },
      responses: {
        201: jsonResponse(voiceAnswerSchema),
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        503: errorResponse,
      },
    },
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
    },
  )

// Ends a voice session and releases its connections.
export const endVoiceSessionRoute = (manager: VoiceSessionManager) =>
  route(
    {
      method: 'post',
      path: '/v1/voice/sessions/{id}/end',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        204: { description: 'Session ended' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
      },
    },
    async (c) => {
      await manager.end(c.req.valid('param').id)
      return c.body(null, 204)
    },
  )

// Returns the current connection state of a voice session.
export const getVoiceSessionRoute = (manager: VoiceSessionManager) =>
  route(
    {
      method: 'get',
      path: '/v1/voice/sessions/{id}',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: jsonResponse(voiceStatusSchema),
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
      },
    },
    async (c) => {
      const status = await manager.status(c.req.valid('param').id)

      if (!status) {
        return fail(c, 404, 'not_found', 'Session not found')
      }

      return c.json(status, 200)
    },
  )
