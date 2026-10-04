declare const sampleRate: number

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

declare function registerProcessor(
  name: string,
  processor: new () => AudioWorkletProcessor,
): void

const MAX_BUFFER_SAMPLES = sampleRate * 30
const MAX_PAUSE_SAMPLES = sampleRate * 0.35
const SPEECH_RMS = 0.0015

// Keep startup speech in memory until the WebRTC data channel reports readiness.
function hasSpeech(samples: Float32Array) {
  let energy = 0

  for (const sample of samples) {
    energy += sample * sample
  }

  return Math.sqrt(energy / samples.length) >= SPEECH_RMS
}

class StartupAudioBuffer extends AudioWorkletProcessor {
  private chunks: Float32Array[] = []
  private head = 0
  private samples = 0
  private pauseSamples = 0
  private connected = false
  private muted = false

  constructor() {
    super()

    this.port.onmessage = ({
      data,
    }: MessageEvent<
      { type: 'activate' } | { type: 'mute'; muted: boolean }
    >) => {
      if (data.type === 'activate') {
        this.connected = true
        this.trimStartupSilence()
      } else if (data.type === 'mute') {
        this.muted = data.muted

        if (this.muted) {
          this.clear()
        }
      }
    }
  }

  clear() {
    this.chunks = []
    this.head = 0
    this.samples = 0
    this.pauseSamples = 0
  }

  enqueue(input: Float32Array) {
    const chunk = new Float32Array(input)
    this.chunks.push(chunk)
    this.samples += chunk.length

    while (this.samples > MAX_BUFFER_SAMPLES) {
      this.samples -= this.chunks[this.head].length
      this.head += 1
    }

    if (this.head > 1024) {
      this.chunks = this.chunks.slice(this.head)
      this.head = 0
    }
  }

  trimStartupSilence() {
    // Shorten pauses so the queued speech catches up without changing its order.
    const chunks = this.chunks.slice(this.head)
    const speech = chunks.map(hasSpeech)
    const first = speech.indexOf(true)

    if (first === -1) {
      this.clear()
      return
    }

    const last = speech.lastIndexOf(true)
    const margin = Math.ceil(MAX_PAUSE_SAMPLES / chunks[0].length)
    const kept: Float32Array[] = []
    let pauseSamples = 0

    for (
      let index = Math.max(0, first - margin);
      index <= Math.min(chunks.length - 1, last + margin);
      index += 1
    ) {
      const chunk = chunks[index]

      if (speech[index]) {
        pauseSamples = 0
        kept.push(chunk)
      } else if (pauseSamples < MAX_PAUSE_SAMPLES) {
        pauseSamples += chunk.length
        kept.push(chunk)
      }
    }

    this.chunks = kept
    this.head = 0
    this.samples = kept.reduce((sum, chunk) => sum + chunk.length, 0)
    this.pauseSamples = 0
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]?.[0]

    if (!output) {
      return true
    }

    output.fill(0)
    const input = inputs[0]?.[0]

    if (!input || this.muted) {
      return true
    }

    if (!this.connected) {
      this.enqueue(input)
      return true
    }

    if (this.head === this.chunks.length) {
      output.set(input)
      return true
    }

    if (hasSpeech(input)) {
      this.pauseSamples = 0
      this.enqueue(input)
    } else if (this.pauseSamples < MAX_PAUSE_SAMPLES) {
      this.pauseSamples += input.length
      this.enqueue(input)
    }

    const next = this.chunks[this.head]
    output.set(next)
    this.samples -= next.length
    this.head += 1

    if (this.head === this.chunks.length) {
      this.clear()
    }

    return true
  }
}

registerProcessor('startup-audio-buffer', StartupAudioBuffer)

export {}
