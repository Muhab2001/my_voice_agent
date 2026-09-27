import type { VoiceTransport, VoiceTransportEvents } from './types'

export class SimulatedVoiceTransport implements VoiceTransport {
  private stream: MediaStream | null = null
  private audio = new Audio('/audio/demo-sound.wav')
  private audioContext: AudioContext | null = null
  private animationFrame: number | null = null
  private timers: number[] = []
  private stopped = false
  private muted = false

  constructor(private events: VoiceTransportEvents) {
    this.audio.preload = 'auto'
    this.audio.addEventListener('ended', this.events.onAudioEnded)
  }

  async start() {
    this.events.onStatus('connecting')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Microphone access is not available in this browser or context.',
        )
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (this.stopped) {
        stream.getTracks().forEach((track) => {
          track.stop()
        })
        return
      }
      this.stream = stream
      this.setMuted(this.muted)
      this.observeMicrophone(stream)
      this.events.onStatus('connected')
      this.timers.push(window.setTimeout(() => this.events.onAudioReady(), 900))
    } catch (error) {
      if (this.stopped) return
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow access in your browser and try again.'
          : error instanceof Error
            ? error.message
            : 'Could not start the microphone.'
      this.events.onError(message)
      this.events.onStatus('error')
      throw error
    }
  }

  private observeMicrophone(stream: MediaStream) {
    if (!window.AudioContext) return
    try {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      context.createMediaStreamSource(stream).connect(analyser)
      this.audioContext = context
      const samples = new Uint8Array(analyser.fftSize)
      let lastUpdate = 0
      const tick = (now: number) => {
        if (this.stopped) return
        if (now - lastUpdate >= 50) {
          analyser.getByteTimeDomainData(samples)
          let sum = 0
          for (const sample of samples) {
            const value = (sample - 128) / 128
            sum += value * value
          }
          const rms = Math.sqrt(sum / samples.length)
          this.events.onInputLevel(
            this.muted ? 0 : Math.min(1, Math.max(0, (rms - 0.015) * 12)),
          )
          lastUpdate = now
        }
        this.animationFrame = window.requestAnimationFrame(tick)
      }
      this.animationFrame = window.requestAnimationFrame(tick)
      void context.resume().catch(() => {})
    } catch {
      this.events.onInputLevel(0)
    }
  }

  stop() {
    this.stopped = true
    this.timers.forEach((timer) => {
      window.clearTimeout(timer)
    })
    this.timers = []
    if (this.animationFrame !== null)
      window.cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    void this.audioContext?.close()
    this.audioContext = null
    this.stream?.getTracks().forEach((track) => {
      track.stop()
    })
    this.stream = null
    this.audio.pause()
    this.audio.currentTime = 0
    this.events.onInputLevel(0)
    this.events.onStatus('idle')
  }

  setMuted(muted: boolean) {
    this.muted = muted
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted
    })
    if (muted) this.events.onInputLevel(0)
  }

  async playIncoming() {
    this.audio.currentTime = 0
    await this.audio.play()
    this.events.onTranscript({
      id: crypto.randomUUID(),
      text: 'Hello! I’m ready to help.\nWhat can I help you with?',
    })
  }

  pauseIncoming() {
    this.audio.pause()
  }

  isPlaying() {
    return !this.audio.paused
  }
}
