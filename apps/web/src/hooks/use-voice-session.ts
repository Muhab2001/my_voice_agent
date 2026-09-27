import { useCallback, useEffect, useRef, useState } from 'react'
import { SimulatedVoiceTransport } from '../transports/simulated-voice-transport'
import type {
  TranscriptItem,
  VoiceStatus,
  VoiceTransport,
  VoiceTransportFactory,
} from '../transports/types'

const createSimulatedTransport: VoiceTransportFactory = (events) =>
  new SimulatedVoiceTransport(events)

export function useVoiceSession(
  createTransport: VoiceTransportFactory = createSimulatedTransport,
) {
  const transport = useRef<VoiceTransport | null>(null)
  const captionTimers = useRef<number[]>([])
  const captionQueue = useRef<TranscriptItem[]>([])
  const captionActive = useRef(false)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [muted, setMuted] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])

  const clearCaptions = useCallback(() => {
    captionTimers.current.forEach((timer) => {
      window.clearTimeout(timer)
    })
    captionTimers.current = []
    captionQueue.current = []
    captionActive.current = false
    setTranscript([])
  }, [])

  const showNextCaption = useCallback(function showNextCaption() {
    const next = captionQueue.current.shift()
    if (!next) {
      captionActive.current = false
      return
    }

    captionActive.current = true
    setTranscript([next])
    captionTimers.current.push(
      window.setTimeout(() => {
        setTranscript([{ ...next, fading: true }])
        captionTimers.current.push(
          window.setTimeout(() => {
            setTranscript([])
            captionTimers.current.push(window.setTimeout(showNextCaption, 120))
          }, 700),
        )
      }, 1500),
    )
  }, [])

  const enqueueCaption = useCallback(
    (item: TranscriptItem) => {
      captionQueue.current.push(
        ...item.text
          .split('\n')
          .map((text, index) => ({
            id: `${item.id}-${index}`,
            text: text.trim(),
          }))
          .filter((line) => line.text.length > 0),
      )
      if (!captionActive.current) showNextCaption()
    },
    [showNextCaption],
  )

  const stop = useCallback(() => {
    transport.current?.stop()
    transport.current = null
    clearCaptions()
    setAudioPlaying(false)
    setAudioReady(false)
    setInputLevel(0)
    setMuted(false)
    setStatus('idle')
  }, [clearCaptions])

  const pause = useCallback(() => {
    transport.current?.stop()
    transport.current = null
    clearCaptions()
    setAudioPlaying(false)
    setAudioReady(false)
    setInputLevel(0)
    setMuted(false)
    setStatus('paused')
  }, [clearCaptions])

  useEffect(
    () => () => {
      transport.current?.stop()
      captionTimers.current.forEach((timer) => {
        window.clearTimeout(timer)
      })
    },
    [],
  )

  const start = useCallback(async () => {
    if (transport.current) return
    setError(null)
    clearCaptions()
    setAudioReady(false)
    const next = createTransport({
      onStatus: setStatus,
      onInputLevel: setInputLevel,
      onTranscript: enqueueCaption,
      onAudioReady: () => {
        setAudioReady(true)
        setAudioPlaying(true)
        void next.playIncoming().catch(() => {
          setAudioPlaying(false)
          setError('Tap the orb to play the sample sound.')
        })
      },
      onAudioEnded: () => {
        setAudioPlaying(false)
      },
      onError: setError,
    })
    transport.current = next
    try {
      await next.start()
    } catch {
      next.stop()
      if (transport.current === next) {
        transport.current = null
        setStatus('error')
      }
    }
  }, [clearCaptions, createTransport, enqueueCaption])

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      transport.current?.setMuted(!current)
      return !current
    })
  }, [])

  const replayAudio = useCallback(async () => {
    const current = transport.current
    if (!current || !audioReady || current.isPlaying()) return
    try {
      clearCaptions()
      setAudioPlaying(true)
      await current.playIncoming()
      setError(null)
    } catch {
      setAudioPlaying(false)
      setError('Audio could not play. Check your browser audio settings.')
    }
  }, [audioReady, clearCaptions])

  return {
    status,
    muted,
    audioReady,
    audioPlaying,
    inputLevel,
    error,
    transcript,
    start,
    stop,
    pause,
    toggleMute,
    replayAudio,
  }
}
