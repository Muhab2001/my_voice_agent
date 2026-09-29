import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlaceCard, ReservationOptions } from '../ui-events/types'
import { VoiceUiEventStream } from '../ui-events/voice-ui-event-stream'

/** Owns the browser UI stream and its presentation state for one voice session. */
export function useVoiceUiEvents(
  onLocationRequest: (sessionId: string, requestId: string) => void,
  onReservationState: (state: unknown) => void,
  onReservationOptions: (options: ReservationOptions) => void,
) {
  const stream = useRef<VoiceUiEventStream | null>(null)
  const [placeCard, setPlaceCard] = useState<PlaceCard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    stream.current?.stop()
    stream.current = null
    setPlaceCard(null)
    setError(null)
  }, [])

  useEffect(
    () => () => {
      stream.current?.stop()
    },
    [],
  )

  const start = useCallback(
    async (sessionId: string) => {
      stream.current?.stop()
      setPlaceCard(null)
      setError(null)

      const next = new VoiceUiEventStream({
        onEvent: (event) => {
          if (stream.current !== next) {
            return
          }

          switch (event.type) {
            case 'location-request':
              onLocationRequest(sessionId, event.requestId)
              break
            case 'place-card':
              setPlaceCard(event.card)
              break
            case 'reservation-state':
              onReservationState(event.reservation)
              break
            case 'reservation-options':
              onReservationOptions({ kind: event.kind, options: event.options })
              break
          }
        },
        onError: (message) => {
          if (stream.current === next) {
            setError(message)
          }
        },
      })
      stream.current = next
      await next.start(sessionId)
    },
    [onLocationRequest, onReservationState, onReservationOptions],
  )

  return {
    placeCard,
    error,
    start,
    stop,
    dismissPlaceCard: () => setPlaceCard(null),
  }
}
