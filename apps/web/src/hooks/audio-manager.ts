import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionConnection } from './session-manager'

type AudioResources = {
  muted: boolean
  controller: AbortController
  audio: HTMLAudioElement
  stream?: MediaStream
  context?: AudioContext
  frame?: number
}

/** Owns microphone and playback only; the session manager owns the peer and channel. */
export function useAudioManager() {
  const resources = useRef<AudioResources | null>(null)
  const [muted, setMuted] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const [inputLevel, setInputLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const end = useCallback(() => {
    resources.current?.controller.abort()
    resources.current = null
    setMuted(false)
    setAudioReady(false)
    setAudioPlaying(false)
    setInputLevel(0)
  }, [])

  useEffect(() => end, [end])

  const start = useCallback(
    async (connection: SessionConnection) => {
      end()

      if (connection.signal.aborted) {
        return
      }

      setError(null)
      const controller = new AbortController()
      const { signal } = controller
      const audio = new Audio()
      audio.autoplay = true
      const current: AudioResources = { controller, audio, muted: false }
      resources.current = current
      const onPlaying = () => setAudioPlaying(true)
      const onPause = () => setAudioPlaying(false)
      const onTrack = (event: RTCTrackEvent) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track])
        setAudioReady(true)
        void audio.play().catch(() => {
          if (!signal.aborted) {
            setError('Tap the orb to enable assistant audio.')
          }
        })
      }
      const onSessionEnd = () => {
        end()
      }
      audio.addEventListener('playing', onPlaying)
      audio.addEventListener('pause', onPause)
      connection.peer.addEventListener('track', onTrack)
      connection.signal.addEventListener('abort', onSessionEnd, { once: true })
      signal.addEventListener(
        'abort',
        () => {
          connection.signal.removeEventListener('abort', onSessionEnd)
          connection.peer.removeEventListener('track', onTrack)
          audio.removeEventListener('playing', onPlaying)
          audio.removeEventListener('pause', onPause)

          if (current.frame !== undefined) {
            window.cancelAnimationFrame(current.frame)
          }

          void current.context?.close()
          current.stream?.getTracks().forEach((track) => {
            track.stop()
          })
          audio.pause()
          audio.srcObject = null
        },
        { once: true },
      )

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            'Microphone access is unavailable. Use HTTPS or localhost.',
          )
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })

        if (signal.aborted) {
          stream.getTracks().forEach((track) => {
            track.stop()
          })

          return
        }

        current.stream = stream

        for (const track of stream.getAudioTracks()) {
          track.enabled = !current.muted
          connection.peer.addTrack(track, stream)
        }

        try {
          const context = new AudioContext()
          current.context = context
          const analyser = context.createAnalyser()
          analyser.fftSize = 256
          context.createMediaStreamSource(stream).connect(analyser)
          const samples = new Uint8Array(analyser.fftSize)
          let lastUpdate = 0
          const tick = (now: number) => {
            if (signal.aborted) {
              return
            }

            if (now - lastUpdate >= 50) {
              analyser.getByteTimeDomainData(samples)
              const rms = Math.sqrt(
                samples.reduce(
                  (sum, sample) => sum + ((sample - 128) / 128) ** 2,
                  0,
                ) / samples.length,
              )
              setInputLevel(
                stream.getAudioTracks().some((track) => track.enabled)
                  ? Math.min(1, Math.max(0, (rms - 0.015) * 12))
                  : 0,
              )
              lastUpdate = now
            }

            current.frame = window.requestAnimationFrame(tick)
          }
          current.frame = window.requestAnimationFrame(tick)
          void context.resume().catch(() => {})
        } catch {
          setInputLevel(0)
        }
      } catch (cause) {
        if (signal.aborted) {
          return
        }

        end()
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Microphone access was denied. Allow access in your browser and try again.'
            : cause instanceof Error
              ? cause.message
              : 'Could not capture microphone audio.',
        )
        throw cause
      }
    },
    [end],
  )

  const toggleMute = useCallback(() => {
    setMuted((value) => {
      if (resources.current) {
        resources.current.muted = !value
      }

      resources.current?.stream?.getAudioTracks().forEach((track) => {
        track.enabled = value
      })

      if (!value) {
        setInputLevel(0)
      }

      return !value
    })
  }, [])

  const replayAudio = useCallback(async () => {
    const current = resources.current

    if (!current || !audioReady || !current.audio.paused) {
      return
    }

    try {
      await current.audio.play()

      if (!current.controller.signal.aborted) {
        setError(null)
      }
    } catch {
      if (!current.controller.signal.aborted) {
        setError('Audio could not play. Check your browser audio settings.')
      }
    }
  }, [audioReady])

  return {
    muted,
    audioReady,
    audioPlaying,
    inputLevel,
    error,
    start,
    end,
    toggleMute,
    replayAudio,
  }
}
