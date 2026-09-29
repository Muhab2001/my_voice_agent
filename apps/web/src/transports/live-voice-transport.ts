import {
  voiceAnswerSchema,
  voiceStatusSchema,
  voiceUiEventSchema,
} from '@voice/contracts'
import { ApiClient } from '../lib/api-client'
import { liveVoiceEventSchema } from './live-voice-events.js'
import type { VoiceTransport, VoiceTransportEvents } from './types'

const emptyResponse = { parse: () => undefined }

/**
 * Owns one browser voice session: microphone capture, WebRTC media, captions and cleanup.
 * SDP negotiation and authenticated lifecycle/status requests go through our API;
 * microphone and assistant audio travel directly over WebRTC to/from the provider.
 * Data-channel events update the UI. Private tools and transcript persistence run on
 * the server sideband. Create a fresh transport instance for every Start after Stop.
 */
export class LiveVoiceTransport implements VoiceTransport {
  private peer: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private audio = new Audio()
  private audioContext: AudioContext | null = null
  private frame: number | null = null
  private channel: RTCDataChannel | null = null
  private id: string | null = null
  private stopped = false
  private failed = false
  private finalized = false
  private muted = false
  private ending: Promise<void> | null = null
  private polling: number | null = null
  private uiController: AbortController | null = null
  private uiReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private connectTimer: number | null = null
  private disconnectTimer: number | null = null
  private captions = { user: '', assistant: '' }
  private lastRole: 'user' | 'assistant' | null = null
  private captionId = crypto.randomUUID()

  /** Wire native playback events to the voice hook; blocked autoplay is recoverable by user gesture. */
  constructor(private events: VoiceTransportEvents) {
    this.audio.autoplay = true
    this.audio.addEventListener('playing', () => this.events.onAudioReady())
    this.audio.addEventListener('pause', () => this.events.onAudioEnded())
  }

  /**
   * Request microphone permission, install media/data-channel listeners, gather ICE,
   * and exchange the SDP offer for our API's answer. Connected status waits for
   * session.started. If Stop races setup, release late tracks and end any late session.
   */
  async start() {
    this.events.onStatus('connecting')

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Microphone access is unavailable. Use HTTPS or localhost.',
        )
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      if (this.stopped) {
        stream.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }

      this.stream = stream
      this.setMuted(this.muted)
      this.observeMicrophone(stream)
      const peer = new RTCPeerConnection()
      this.peer = peer
      peer.addEventListener('track', (event) => {
        if (this.stopped) {
          return
        }

        this.audio.srcObject =
          event.streams[0] ?? new MediaStream([event.track])
        this.events.onAudioReady()
        void this.playIncoming().catch(() =>
          this.events.onError('Tap the orb to enable assistant audio.'),
        )
      })
      peer.addEventListener('connectionstatechange', () => {
        if (this.stopped) {
          return
        }

        if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'closed'
        ) {
          this.fail('Voice connection was lost.')
        }

        if (
          peer.connectionState === 'disconnected' &&
          this.disconnectTimer === null
        ) {
          this.disconnectTimer = window.setTimeout(
            () => this.fail('Voice connection was lost.'),
            3000,
          )
        } else if (
          peer.connectionState === 'connected' &&
          this.disconnectTimer !== null
        ) {
          window.clearTimeout(this.disconnectTimer)
          this.disconnectTimer = null
        }
      })

      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream)
      }

      const channel = peer.createDataChannel('oai-events')
      this.channel = channel
      channel.addEventListener('message', ({ data }) => {
        try {
          this.receive(JSON.parse(data))
        } catch {
          this.fail('Invalid voice event received.')
        }
      })
      channel.addEventListener('close', () => {
        if (!this.stopped && !this.finalized) {
          this.fail('Voice connection ended without confirmed finalization.')
        }
      })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await this.gatherIce(peer)

      if (this.stopped) {
        return
      }

      const result = await ApiClient.post(
        '/v1/voice/sessions',
        { sdp: peer.localDescription?.sdp },
        voiceAnswerSchema,
      )
      this.id = result.id

      if (this.stopped) {
        await this.endRemote()
        return
      }

      this.connectTimer = window.setTimeout(
        () => this.fail('Voice session did not connect. Please try again.'),
        15_000,
      )
      await this.openUiEvents(result.id)

      if (this.stopped) {
        return
      }

      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp })
      this.polling = window.setInterval(() => {
        void this.pollStatus()
      }, 2000)
    } catch (error) {
      if (this.stopped) {
        return
      }

      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow access in your browser and try again.'
          : error instanceof Error
            ? error.message
            : 'Could not start the voice session.'
      this.fail(message)
      throw error
    }
  }

  /** Receive app UI events on one authenticated stream; tool results remain on the private sideband. */
  private async openUiEvents(id: string) {
    const controller = new AbortController()
    this.uiController = controller

    try {
      const response = await ApiClient.stream(
        `/v1/voice/sessions/${id}/ui-events`,
        controller.signal,
      )

      if (response.body) {
        void this.readUiEvents(response.body, id, controller.signal)
      }
    } catch {
      if (!this.stopped) {
        this.events.onError(
          'Place and location events could not connect. Try restarting the voice session.',
        )
      }
    }
  }

  private async readUiEvents(
    body: ReadableStream<Uint8Array>,
    id: string,
    signal: AbortSignal,
  ) {
    const reader = body.getReader()
    this.uiReader = reader
    const decoder = new TextDecoder()
    let buffer = ''
    let ended = false

    try {
      while (!signal.aborted) {
        const chunk = await reader.read()

        if (chunk.done) {
          ended = true
          break
        }

        buffer += decoder.decode(chunk.value, { stream: true })
        let boundary = buffer.indexOf('\n\n')

        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => line.slice(6))
            .join('\n')

          if (data) {
            const event = voiceUiEventSchema.safeParse(JSON.parse(data))

            if (event.success && event.data.type === 'location-request') {
              this.events.onLocationRequest?.(id, event.data.requestId)
            } else if (event.success && event.data.type === 'place-card') {
              this.events.onPlaceCard?.(event.data.card)
            }
          }

          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      if (ended && !signal.aborted && !this.stopped) {
        this.events.onError(
          'Place and location updates were interrupted. Restart the voice session.',
        )
      }
    } finally {
      this.uiReader = null
      reader.releaseLock()

      if (!signal.aborted && !this.stopped) {
        this.events.onError(
          'Place and location updates ended. Restart the voice session.',
        )
      }
    }
  }

  /** Wait for ICE candidates before submitting SDP; remove the listener on completion or timeout. */
  private gatherIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === 'complete') {
      return Promise.resolve()
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout)
        peer.removeEventListener('icegatheringstatechange', check)
      }
      const check = () => {
        if (peer.iceGatheringState === 'complete') {
          cleanup()
          resolve()
        }
      }
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('Microphone connection setup timed out.'))
      }, 8000)
      peer.addEventListener('icegatheringstatechange', check)
      check()
    })
  }

  /**
   * Handle provider lifecycle/errors and accumulate partial caption deltas without
   * changing their spaces. Keep only the latest 500 characters for display; this is
   * not the persisted transcript. Closure confirms finalization or reports connection loss.
   */
  private receive(payload: unknown) {
    const parsed = liveVoiceEventSchema.safeParse(payload)

    if (!parsed.success) {
      return
    }

    const event = parsed.data

    if (event.type === 'session.started') {
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer)
      }

      this.connectTimer = null

      if (!this.stopped) {
        this.events.onStatus('connected')
      }
    } else if (event.type === 'session.closed') {
      this.finalized = true

      if (!this.stopped) {
        if (event.reason === 'connection_lost') {
          this.fail('Voice connection was lost.')
        } else {
          void this.stop()
        }
      }
    } else if (event.type === 'error') {
      this.events.onError(
        'The voice provider reported an error. Try stopping and starting again.',
      )
    } else if (!this.stopped) {
      const role =
        event.type === 'session.input_transcript.delta' ? 'user' : 'assistant'

      if (this.lastRole !== role) {
        this.captions[role] = ''
        this.captionId = crypto.randomUUID()
        this.lastRole = role
      }

      this.captions[role] = (this.captions[role] + event.delta).slice(-500)
      this.events.onTranscript({
        id: this.captionId,
        text: this.captions[role],
      })
    }
  }

  /**
   * Poll our API every two seconds because private sideband/tool failures may not
   * appear on the browser data channel. Report errors and stop ended/failed sessions.
   */
  private async pollStatus() {
    if (!this.id || this.stopped) {
      return
    }

    try {
      const status = await ApiClient.get({
        path: `/v1/voice/sessions/${this.id}`,
        schema: voiceStatusSchema,
        authenticated: true,
      })

      if (this.stopped) {
        return
      }

      if (status.error) {
        this.events.onError(status.error)
      }

      if (status.status === 'failed') {
        this.fail(status.error ?? 'The voice session failed.')
      } else if (status.status === 'ended') {
        void this.stop()
      }
    } catch {
      if (!this.stopped) {
        this.fail('Could not reach the voice server.')
      }
    }
  }

  /** Preserve the error state while running the same idempotent cleanup used by Stop. */
  private fail(message: string) {
    this.failed = true
    this.events.onError(message)
    void this.stop()
  }

  /**
   * Immediately mute capture/playback and cancel UI timers, then ask the server to
   * drain tools and final events. Keep the peer/channel alive until that request
   * settles; repeated Stop calls share the same promise and release resources once.
   */
  stop(): Promise<void> {
    if (this.ending) {
      return this.ending
    }

    this.stopped = true
    this.setMuted(true)
    this.audio.muted = true
    this.events.onStatus('stopping')

    if (this.polling !== null) {
      window.clearInterval(this.polling)
    }

    this.uiController?.abort()
    void this.uiReader?.cancel()

    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer)
    }

    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer)
    }

    this.ending = this.endRemote().finally(() => {
      this.release()
      this.events.onStatus(this.failed ? 'error' : 'idle')
    })
    return this.ending
  }

  /**
   * End the local session through our authenticated API and check saved finalization.
   * Bound the wait to 12 seconds and surface incomplete closure. Never send
   * session.close directly: the server must submit pending tool results first.
   */
  private async endRemote() {
    const id = this.id

    if (!id) {
      return
    }

    this.id = null
    // Keep WebRTC and its data channel open while the server drains tools and final events.
    let timeout: number | undefined

    try {
      await Promise.race([
        (async () => {
          await ApiClient.post(
            `/v1/voice/sessions/${id}/end`,
            undefined,
            emptyResponse,
          )
          const status = await ApiClient.get({
            path: `/v1/voice/sessions/${id}`,
            schema: voiceStatusSchema,
            authenticated: true,
          })

          if (status.error || status.finalization !== 'confirmed') {
            this.events.onError(
              status.error ?? 'Session finalization could not be confirmed.',
            )
          }
        })(),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('Session close timed out')),
            12_000,
          )
        }),
      ])
    } catch {
      this.events.onError('Session finalization could not be confirmed.')
    } finally {
      window.clearTimeout(timeout)
    }
  }

  /** Release microphone tracks, Web Audio, animation, data channel, peer and audio element after draining. */
  private release() {
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame)
    }

    void this.audioContext?.close()
    this.stream?.getTracks().forEach((track) => {
      track.stop()
    })
    this.channel?.close()
    this.peer?.close()
    this.audio.pause()
    this.audio.srcObject = null
    this.events.onInputLevel(0)
  }

  /** Toggle microphone tracks locally; muting does not end the provider session or stop incoming audio. */
  setMuted(muted: boolean) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })

    if (muted) {
      this.events.onInputLevel(0)
    }
  }

  /** Play the remote audio stream, including recovery from autoplay denial after an orb click. */
  async playIncoming() {
    if (this.stopped) {
      return
    }

    await this.audio.play()
  }

  /** Pause local playback only; the provider session, listening and backend tool work continue. */
  pauseIncoming() {
    this.audio.pause()
  }

  /** Report whether the audio element is playing, rather than whether the assistant is currently speaking. */
  isPlaying() {
    return !this.audio.paused
  }

  /** Sample microphone amplitude for the orb; this visual meter never uploads or records audio. */
  private observeMicrophone(stream: MediaStream) {
    try {
      const context = new AudioContext()
      this.audioContext = context
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      let lastUpdate = 0
      const tick = (now: number) => {
        if (this.stopped) {
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
          this.events.onInputLevel(
            this.muted ? 0 : Math.min(1, Math.max(0, (rms - 0.015) * 12)),
          )
          lastUpdate = now
        }

        this.frame = window.requestAnimationFrame(tick)
      }
      this.frame = window.requestAnimationFrame(tick)
      void context.resume().catch(() => {})
    } catch {
      this.events.onInputLevel(0)
    }
  }
}
