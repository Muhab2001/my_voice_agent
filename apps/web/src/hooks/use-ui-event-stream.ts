import { useCallback, useEffect, useRef, useState } from 'react'
import type { UIEvent } from '../ui-events/ui-event-stream'
import { UIEventStream } from '../ui-events/ui-event-stream'
import { useAuthenticatedFetch } from './use-authenticated-fetch'

/** Owns the UI event stream for an application session. */
export function useUIEventStream(onEvent: (event: UIEvent) => void) {
  const request = useAuthenticatedFetch()
  const stream = useRef<UIEventStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const end = useCallback(() => {
    stream.current?.end()
    stream.current = null
    setError(null)
  }, [])

  useEffect(
    () => () => {
      stream.current?.end()
      stream.current = null
    },
    [],
  )

  const start = useCallback(
    async (sessionId: string) => {
      stream.current?.end()
      setError(null)

      const next = new UIEventStream(
        {
          onEvent,
          onError: setError,
        },
        request,
      )
      stream.current = next
      await next.start(sessionId)
    },
    [onEvent, request],
  )

  return {
    error,
    start,
    end,
  }
}
