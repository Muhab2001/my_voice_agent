export class FakeAudio extends EventTarget {
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

export class FakePeer extends EventTarget {
  static current: FakePeer
  channel = new FakeChannel()
  iceGatheringState = 'complete'
  connectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteAnswer: string | undefined
  closed = false
  addedTracks: { track: unknown; stream: unknown }[] = []

  constructor() {
    super()
    FakePeer.current = this
  }

  addTrack(track: unknown, stream: unknown) {
    this.addedTracks.push({ track, stream })
  }

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

export function browserFixture(options: { preserveBrowser?: boolean } = {}) {
  FakeAudio.blocked = false
  const names = options.preserveBrowser
    ? (['Audio', 'RTCPeerConnection'] as const)
    : (['Audio', 'RTCPeerConnection', 'navigator', 'window'] as const)
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

  return {
    track,
    media,
    restore() {
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
