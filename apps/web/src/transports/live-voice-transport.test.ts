import { expect, spyOn, test } from 'bun:test'
import { ApiClient } from '../lib/api-client'
import { LiveVoiceTransport } from './live-voice-transport'
import type { VoiceStatus } from './types'

class FakeAudio extends EventTarget {
  static blocked = false
  autoplay = false
  muted = false
  paused = true
  srcObject: MediaStream | null = null

  async play() {
    if (FakeAudio.blocked) {
      throw new DOMException('Autoplay blocked', 'NotAllowedError')
    }

    this.paused = false
    this.dispatchEvent(new Event('playing'))
  }

  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

class FakeChannel extends EventTarget {
  close() {
    this.dispatchEvent(new Event('close'))
  }

  event(event: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify(event) }),
    )
  }
}

class FakePeer extends EventTarget {
  static current: FakePeer
  channel = new FakeChannel()
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteAnswer: string | undefined
  closed = false

  constructor() {
    super()
    FakePeer.current = this
  }

  addTrack() {}

  createDataChannel() {
    return this.channel
  }

  async createOffer() {
    return { type: 'offer' as const, sdp: 'offer' }
  }

  async setLocalDescription(offer: RTCSessionDescriptionInit) {
    this.localDescription = offer
  }

  async setRemoteDescription(answer: RTCSessionDescriptionInit) {
    this.remoteAnswer = answer.sdp
    this.channel.event({ type: 'session.started' })
  }

  close() {
    this.closed = true
  }
}

function browserFixture() {
  FakeAudio.blocked = false
  const names = ['Audio', 'RTCPeerConnection', 'navigator', 'window'] as const
  const previous = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  )
  const track = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true
    },
  }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  const media = { getUserMedia: async () => stream }
  const values = {
    Audio: FakeAudio,
    RTCPeerConnection: FakePeer,
    navigator: { mediaDevices: media },
    window: {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestAnimationFrame: () => 1,
      cancelAnimationFrame: () => {},
    },
  }

  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: values[name],
    })
  }

  const statuses: VoiceStatus[] = []
  const errors: string[] = []
  const captions: string[] = []
  const transport = new LiveVoiceTransport({
    onStatus: (status) => statuses.push(status),
    onError: (error) => errors.push(error),
    onTranscript: (item) => captions.push(item.text),
    onInputLevel: () => {},
    onAudioReady: () => {},
    onAudioEnded: () => {},
  })
  const post = spyOn(ApiClient, 'post').mockImplementation(
    async (path, _body, schema) =>
      schema.parse(
        path === '/v1/voice/sessions'
          ? { id: crypto.randomUUID(), sdp: 'answer' }
          : undefined,
      ),
  )
  const get = spyOn(ApiClient, 'get').mockImplementation(async ({ schema }) =>
    schema.parse({
      id: crypto.randomUUID(),
      status: 'ended',
      error: null,
      finalization: 'confirmed',
    }),
  )

  return {
    transport,
    post,
    get,
    track,
    media,
    statuses,
    errors,
    captions,
    restore() {
      post.mockRestore()
      get.mockRestore()
      for (const [name, descriptor] of previous) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor)
        } else {
          Reflect.deleteProperty(globalThis, name)
        }
      }
    },
  }
}

test('transport starts through HTTP, connects WebRTC, and keeps captions and mute working', async () => {
  const fixture = browserFixture()

  try {
    expect(await fixture.transport.start()).toBeTruthy()
    expect(fixture.post).toHaveBeenCalledWith(
      '/v1/voice/sessions',
      { sdp: 'offer' },
      expect.anything(),
    )
    expect(FakePeer.current.remoteAnswer).toBe('answer')
    expect(fixture.statuses.at(-1)).toBe('connected')
    FakePeer.current.channel.event({
      type: 'session.input_transcript.delta',
      delta: 'I like',
    })
    FakePeer.current.channel.event({
      type: 'session.input_transcript.delta',
      delta: ' tea',
    })
    expect(fixture.captions.at(-1)).toBe('I like tea')
    fixture.transport.setMuted(true)
    expect(fixture.track.enabled).toBe(false)
    await fixture.transport.stop()
    expect(fixture.track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
    expect(fixture.statuses.at(-1)).toBe('idle')
  } finally {
    fixture.restore()
  }
})

test('stopping during microphone permission releases late tracks', async () => {
  const fixture = browserFixture()
  let release!: (
    value: Awaited<ReturnType<typeof fixture.media.getUserMedia>>,
  ) => void
  fixture.media.getUserMedia = () =>
    new Promise<Awaited<ReturnType<typeof fixture.media.getUserMedia>>>(
      (resolve) => {
        release = resolve
      },
    )

  try {
    const preparing = fixture.transport.start()

    while (!release) {
      await Bun.sleep(1)
    }

    await fixture.transport.stop()
    release({
      getTracks: () => [fixture.track],
      getAudioTracks: () => [fixture.track],
    })
    await preparing
    expect(fixture.track.stopped).toBe(true)
  } finally {
    fixture.restore()
  }
})

test('Stop during session creation ends a late HTTP session', async () => {
  const fixture = browserFixture()
  let release!: (result: { id: string; sdp: string }) => void
  fixture.post.mockImplementation(async (path, _body, schema) =>
    schema.parse(
      path === '/v1/voice/sessions'
        ? await new Promise<{ id: string; sdp: string }>((resolve) => {
            release = resolve
          })
        : undefined,
    ),
  )

  try {
    const starting = fixture.transport.start()

    while (!release) {
      await Bun.sleep(1)
    }

    await fixture.transport.stop()
    const id = crypto.randomUUID()
    release({ id, sdp: 'answer' })
    await starting
    expect(fixture.post).toHaveBeenLastCalledWith(
      `/v1/voice/sessions/${id}/end`,
      undefined,
      expect.anything(),
    )
    expect(fixture.track.stopped).toBe(true)
  } finally {
    fixture.restore()
  }
})

test('brief peer disconnect recovers without ending media', async () => {
  const fixture = browserFixture()

  try {
    await fixture.transport.start()
    FakePeer.current.connectionState = 'disconnected'
    FakePeer.current.dispatchEvent(new Event('connectionstatechange'))
    FakePeer.current.connectionState = 'connected'
    FakePeer.current.dispatchEvent(new Event('connectionstatechange'))
    expect(fixture.statuses.at(-1)).toBe('connected')
    expect(FakePeer.current.closed).toBe(false)
    await fixture.transport.stop()
  } finally {
    fixture.restore()
  }
})

test('denied microphone permission reports an error and releases media', async () => {
  const fixture = browserFixture()
  fixture.media.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError')
  }

  try {
    await expect(fixture.transport.start()).rejects.toThrow()
    expect(fixture.errors[0]).toContain('Microphone access was denied')
    await fixture.transport.stop()
    expect(fixture.statuses.at(-1)).toBe('error')
  } finally {
    fixture.restore()
  }
})

test('autoplay denial leaves media connected for manual playback recovery', async () => {
  const fixture = browserFixture()

  try {
    await fixture.transport.start()
    FakeAudio.blocked = true
    FakePeer.current.dispatchEvent(
      Object.assign(new Event('track'), { streams: [{}], track: {} }),
    )
    await Bun.sleep(1)
    expect(fixture.errors.at(-1)).toContain('Tap the orb')
    expect(FakePeer.current.closed).toBe(false)
    FakeAudio.blocked = false
    await fixture.transport.playIncoming()
    expect(fixture.transport.isPlaying()).toBe(true)
    await fixture.transport.stop()
  } finally {
    fixture.restore()
  }
})

test('provider closure reports completion while media stays available for session finalization', async () => {
  const fixture = browserFixture()

  try {
    await fixture.transport.start()
    FakePeer.current.channel.event({
      type: 'session.closed',
      reason: 'close_requested',
    })
    expect(fixture.statuses.at(-1)).toBe('stopping')
    await fixture.transport.stop()
  } finally {
    fixture.restore()
  }
})

test('Stop keeps media until server finalization finishes', async () => {
  const fixture = browserFixture()
  let finish!: () => void
  fixture.post.mockImplementation(async (path, _body, schema) => {
    if (path === '/v1/voice/sessions') {
      return schema.parse({ id: crypto.randomUUID(), sdp: 'answer' })
    }

    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return schema.parse(undefined)
  })

  try {
    await fixture.transport.start()
    const stopping = fixture.transport.stop()
    expect(fixture.track.stopped).toBe(false)
    expect(FakePeer.current.closed).toBe(false)
    finish()
    await stopping
    expect(fixture.track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
  } finally {
    fixture.restore()
  }
})

test('Stop surfaces server tool errors and incomplete finalization', async () => {
  const fixture = browserFixture()
  fixture.get.mockImplementation(async ({ schema }) =>
    schema.parse({
      id: crypto.randomUUID(),
      status: 'failed',
      error: 'Memory tool failed',
      finalization: 'incomplete',
    }),
  )

  try {
    await fixture.transport.start()
    await fixture.transport.stop()
    expect(fixture.errors).toContain('Memory tool failed')
    expect(fixture.track.stopped).toBe(true)
  } finally {
    fixture.restore()
  }
})
