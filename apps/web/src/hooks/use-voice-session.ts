import { useCallback, useEffect, useRef, useState } from 'react'
import { LiveVoiceTransport } from '../transports/live-voice-transport'
import type {
  PlaceCard,
  TranscriptItem,
  VoiceStatus,
  VoiceTransport,
  VoiceTransportFactory,
} from '../transports/types'

const createLiveTransport: VoiceTransportFactory = (events) =>
  new LiveVoiceTransport(events)

export function useVoiceSession(
  createTransport: VoiceTransportFactory = createLiveTransport,
  onLocationRequest?: (sessionId: string, requestId: string) => void,
) {
  const transport = useRef<VoiceTransport | null>(null)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [placeCard, setPlaceCard] = useState<PlaceCard | null>(null)

  const stop = useCallback(async () => {
    const current = transport.current
    if (!current) {
      return
    }
    await current.stop()
    if (transport.current !== current) {
      return
    }
    transport.current = null
    setTranscript([])
    setAudioPlaying(false)
    setAudioReady(false)
    setInputLevel(0)
    setMuted(false)
    setStatus('idle')
  }, [])

  useEffect(
    () => () => {
      void transport.current?.stop()
    },
    [],
  )

  const start = useCallback(async () => {
    if (transport.current) {
      return
    }
    setError(null)
    setTranscript([])
    setPlaceCard(null)
    setAudioReady(false)
    const next = createTransport({
      onStatus: (value) => {
        if (transport.current !== next) {
          return
        }
        setStatus(value)
        if (value === 'idle' || value === 'error') {
          transport.current = null
          setTranscript([])
          setAudioPlaying(false)
          setAudioReady(false)
          setInputLevel(0)
          setMuted(false)
        }
      },
      onInputLevel: (value) => {
        if (transport.current === next) {
          setInputLevel(value)
        }
      },
      onTranscript: (item) => {
        if (transport.current === next) {
          setTranscript([item])
        }
      },
      onAudioReady: () => {
        if (transport.current !== next) {
          return
        }
        setAudioReady(true)
        setAudioPlaying(true)
      },
      onAudioEnded: () => {
        if (transport.current === next) {
          setAudioPlaying(false)
        }
      },
      onError: (message) => {
        if (transport.current !== next) {
          return
        }
        setError(message)
        setAudioPlaying(next.isPlaying())
      },
      onPlaceCard: (card) => {
        if (transport.current === next) {
          setPlaceCard(card)
        }
      },
      onLocationRequest: (sessionId, requestId) => {
        if (transport.current === next) {
          onLocationRequest?.(sessionId, requestId)
        }
      },
    })
    transport.current = next
    try {
      await next.start()
    } catch {
      await next.stop()
    }
  }, [createTransport, onLocationRequest])

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      transport.current?.setMuted(!value)
      return !value
    })
  }, [])

  const replayAudio = useCallback(async () => {
    const current = transport.current
    if (!current || !audioReady || current.isPlaying()) {
      return
    }
    try {
      await current.playIncoming()
      setAudioPlaying(true)
      setError(null)
    } catch {
      setError('Audio could not play. Check your browser audio settings.')
    }
  }, [audioReady])

  return {
    status,
    muted,
    audioReady,
    audioPlaying,
    inputLevel,
    error,
    transcript,
    placeCard,
    dismissPlaceCard: () => setPlaceCard(null),
    start,
    stop,
    toggleMute,
    replayAudio,
  }
}
