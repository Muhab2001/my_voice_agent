import { voiceUiEventSchema } from '@voice/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { assertOk, useApi } from './api'

export type UIEvent = z.infer<typeof voiceUiEventSchema>

type ActiveStream = {
  controller: AbortController
  reader?: ReadableStreamDefaultReader<Uint8Array>
}

function closeStream(stream: ActiveStream) {
  stream.controller.abort()
  void stream.reader?.cancel().catch(() => {})
}

function parseFrame(frame: string): UIEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6))
    .join('\n')

  if (!data) {
    return null
  }

  try {
    const parsed = voiceUiEventSchema.safeParse(JSON.parse(data))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Owns one authenticated SSE connection and its browser-facing events. */
export function useUIEventStream(onEvent: (event: UIEvent) => void) {
  const request = useApi()
  const active = useRef<ActiveStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const end = useCallback(() => {
    if (active.current) {
      closeStream(active.current)
      active.current = null
    }

    setError(null)
  }, [])

  useEffect(
    () => () => {
      if (active.current) {
        closeStream(active.current)
        active.current = null
      }
    },
    [],
  )

  const read = useCallback(
    async (body: ReadableStream<Uint8Array>, stream: ActiveStream) => {
      const reader = body.getReader()
      stream.reader = reader
      const decoder = new TextDecoder()
      let buffer = ''
      let interrupted = false

      try {
        while (!stream.controller.signal.aborted) {
          const chunk = await reader.read()

          if (stream.controller.signal.aborted || chunk.done) {
            break
          }

          buffer += decoder.decode(chunk.value, { stream: true })
          buffer = buffer.replace(/\r\n/g, '\n')
          let boundary = buffer.indexOf('\n\n')

          while (boundary !== -1) {
            const event = parseFrame(buffer.slice(0, boundary))
            buffer = buffer.slice(boundary + 2)

            if (event && !stream.controller.signal.aborted) {
              onEvent(event)
            }

            boundary = buffer.indexOf('\n\n')
          }
        }
      } catch {
        interrupted = true
      } finally {
        stream.reader = undefined
        reader.releaseLock()

        if (!stream.controller.signal.aborted) {
          setError(
            interrupted
              ? 'Live updates were interrupted.'
              : 'Live updates ended.',
          )
        }
      }
    },
    [onEvent],
  )

  const start = useCallback(
    async (sessionId: string) => {
      if (active.current) {
        closeStream(active.current)
      }

      const stream: ActiveStream = { controller: new AbortController() }
      active.current = stream
      setError(null)

      try {
        const response = await request({
          path: `/v1/voice/sessions/${sessionId}/ui-events`,
          method: 'GET',
          signal: stream.controller.signal,
        })

        await assertOk(response)

        if (stream.controller.signal.aborted) {
          return
        }

        const body = response.body

        if (!body) {
          setError('Live updates are unavailable.')
          return
        }

        void read(body, stream)
      } catch {
        if (!stream.controller.signal.aborted) {
          setError('Live updates could not connect.')
        }
      }
    },
    [request, read],
  )

  return { error, start, end }
}
