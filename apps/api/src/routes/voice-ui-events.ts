import { voiceIdSchema } from '@voice/contracts'
import type { Handler } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { ApiEnv } from '../app.js'
import { fail } from '../http/responses.js'
import type { VoiceSessionManager } from '../voice/session-manager.js'

/** Streams browser-facing events for one authenticated voice session. */
export const voiceUiEventsHandler =
  (voice: VoiceSessionManager): Handler<ApiEnv> =>
  (c) => {
    const id = voiceIdSchema.shape.id.safeParse(c.req.param('id'))

    if (!id.success || !voice.hasActiveSession(id.data)) {
      return fail(c, 404, 'not_found', 'Session not found')
    }

    return streamSSE(c, async (stream) => {
      let finish!: () => void
      const closed = new Promise<void>((resolve) => {
        finish = resolve
      })
      const unsubscribe = voice.uiEventChannel.subscribe(
        id.data,
        (event) => {
          void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {})
        },
        finish,
      )
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: '{}' }).catch(() => {})
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
  }
