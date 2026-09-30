import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import type { SessionConnection } from './use-session-manager'

/** Caption messages carried by the provider's WebRTC data channel. */
const transcriptEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.input_transcript.delta'),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('session.output_transcript.delta'),
    delta: z.string(),
  }),
])

export type TranscriptItem = { id: string; text: string; fading?: boolean }

/** Subscribes to captions independently of microphone and incoming audio handling. */
export function useTranscripts() {
  const detach = useRef<(() => void) | null>(null)
  const [items, setItems] = useState<TranscriptItem[]>([])

  const end = useCallback(() => {
    detach.current?.()
    detach.current = null
    setItems([])
  }, [])

  const start = useCallback(
    (connection: SessionConnection) => {
      end()

      if (connection.signal.aborted) {
        return
      }

      let role: 'user' | 'assistant' | null = null
      let caption = ''
      let id = ''

      const receive = (message: Event) => {
        let payload: unknown

        try {
          payload = JSON.parse((message as MessageEvent).data)
        } catch {
          return
        }

        const parsed = transcriptEventSchema.safeParse(payload)

        if (!parsed.success) {
          return
        }

        const event = parsed.data
        const nextRole =
          event.type === 'session.input_transcript.delta' ? 'user' : 'assistant'

        if (nextRole !== role) {
          caption = ''
          id = crypto.randomUUID()
          role = nextRole
        }

        caption = (caption + event.delta).slice(-500)
        setItems([{ id, text: caption }])
      }

      connection.channel.addEventListener('message', receive)
      connection.signal.addEventListener('abort', end, { once: true })
      detach.current = () => {
        connection.channel.removeEventListener('message', receive)
        connection.signal.removeEventListener('abort', end)
      }
    },
    [end],
  )

  useEffect(
    () => () => {
      detach.current?.()
    },
    [],
  )

  return { items, start, end }
}
