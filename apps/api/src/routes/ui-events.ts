import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { errorResponse, fail } from '../http/responses.js'
import { route } from '../http/route.js'
import type { VoiceSessionManager } from '../voice/session-manager.js'

// Streams browser UI events for an active voice session.
export const streamUiEventsRoute = (voice: VoiceSessionManager) =>
  route(
    {
      method: 'get',
      path: '/v1/voice/sessions/{id}/ui-events',
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: {
          description: 'Server-sent UI events',
          content: { 'text/event-stream': { schema: z.string() } },
        },
        404: errorResponse,
      },
    },
    (c) => {
      const { id } = c.req.valid('param')

      if (!voice.hasActiveSession(id)) {
        return fail(c, 404, 'not_found', 'Session not found')
      }

      return streamSSE(c, async (stream) => {
        let finish!: () => void
        const closed = new Promise<void>((resolve) => {
          finish = resolve
        })
        const unsubscribe = voice.uiEventChannel.subscribe(
          id,
          (event) => {
            void stream
              .writeSSE({ data: JSON.stringify(event) })
              .catch(() => {})
          },
          finish,
        )
        const heartbeat = setInterval(() => {
          void stream
            .writeSSE({ event: 'heartbeat', data: '{}' })
            .catch(() => {})
        }, 20_000)
        const cleanup = () => {
          clearInterval(heartbeat)
          unsubscribe()
          finish()
        }
        stream.onAbort(cleanup)

        try {
          await stream.writeSSE({ event: 'ready', data: '{}' })
          await closed
        } finally {
          cleanup()
        }
      })
    },
  )
