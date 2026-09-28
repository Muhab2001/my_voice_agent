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
  closed = false

  close() {
    this.closed = true
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

  async setRemoteDescription() {
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
  const post = spyOn(ApiClient, 'post')
  const get = spyOn(ApiClient, 'get').mockImplementation(async ({ schema }) =>
    schema.parse({
      id: crypto.randomUUID(),
      status: 'ended',
      error: null,
      finalization: 'confirmed',
    }),
  )
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
  return {
    transport,
    track,
    media,
    post,
    get,
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

test('browser captions stream with spaces; mute and Stop retain media until server finalizes', async () => {
  const fixture = browserFixture()
  const { transport, post, track, captions, statuses } = fixture
  let finish!: () => void
  post.mockImplementation(async (path, _body, schema) => {
    if (path === '/v1/voice/sessions') {
      return schema.parse({ id: crypto.randomUUID(), sdp: 'answer' })
    }
    await new Promise<void>((resolve) => {
      finish = resolve
    })
    return schema.parse(undefined)
  })
  try {
    await transport.start()
    expect(statuses.at(-1)).toBe('connected')
    FakePeer.current.channel.event({
      type: 'session.input_transcript.delta',
      delta: 'I like',
    })
    FakePeer.current.channel.event({
      type: 'session.input_transcript.delta',
      delta: ' tea',
    })
    expect(captions.at(-1)).toBe('I like tea')
    transport.setMuted(true)
    expect(track.enabled).toBe(false)
    transport.setMuted(false)
    expect(track.enabled).toBe(true)
    const stopping = transport.stop()
    expect(track.stopped).toBe(false)
    expect(FakePeer.current.closed).toBe(false)
    expect(statuses.at(-1)).toBe('stopping')
    finish()
    await stopping
    expect(track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
    expect(statuses.at(-1)).toBe('idle')
  } finally {
    fixture.restore()
  }
})

test('Stop during creation cleans up a late session answer', async () => {
  const fixture = browserFixture()
  const { transport, post, track } = fixture
  let release!: (result: { id: string; sdp: string }) => void
  post.mockImplementation(async (path, _body, schema) => {
    const result =
      path === '/v1/voice/sessions'
        ? await new Promise<{ id: string; sdp: string }>((resolve) => {
            release = resolve
          })
        : undefined
    return schema.parse(result)
  })
  try {
    const started = transport.start()
    while (!release) {
      await Bun.sleep(1)
    }
    await transport.stop()
    expect(track.stopped).toBe(true)
    const id = crypto.randomUUID()
    release({ id, sdp: 'answer' })
    await started
    expect(post).toHaveBeenLastCalledWith(
      `/v1/voice/sessions/${id}/end`,
      undefined,
      expect.anything(),
    )
  } finally {
    fixture.restore()
  }
})

test('denied microphone permission releases resources and gives actionable feedback', async () => {
  const fixture = browserFixture()
  fixture.media.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError')
  }
  try {
    await expect(fixture.transport.start()).rejects.toThrow()
    await fixture.transport.stop()
    expect(fixture.errors[0]).toContain('Microphone access was denied')
    expect(fixture.statuses.at(-1)).toBe('error')
    expect(fixture.post).not.toHaveBeenCalled()
  } finally {
    fixture.restore()
  }
})

test('autoplay denial offers orb playback recovery without dropping the session', async () => {
  const fixture = browserFixture()
  fixture.post.mockImplementation(async (path, _body, schema) =>
    schema.parse(
      path === '/v1/voice/sessions'
        ? { id: crypto.randomUUID(), sdp: 'answer' }
        : undefined,
    ),
  )
  try {
    await fixture.transport.start()
    FakeAudio.blocked = true
    const event = Object.assign(new Event('track'), {
      streams: [{}],
      track: {},
    })
    FakePeer.current.dispatchEvent(event)
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

test('Stop surfaces server tool errors and incomplete finalization', async () => {
  const fixture = browserFixture()
  fixture.post.mockImplementation(async (path, _body, schema) =>
    schema.parse(
      path === '/v1/voice/sessions'
        ? { id: crypto.randomUUID(), sdp: 'answer' }
        : undefined,
    ),
  )
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
