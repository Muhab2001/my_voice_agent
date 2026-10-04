import { expect, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import {
  browserFixture,
  FakeAudio,
  FakePeer,
} from '../test-utils/audio-browser'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { useAudioManager } from './audio-manager'
import type { SessionConnection } from './session-manager'

async function setup() {
  let fixture!: ReturnType<typeof browserFixture>
  const app = await renderAuthenticatedHook(useAudioManager, undefined, {
    setup: () => {
      fixture = browserFixture()
    },
  })
  const peer = new FakePeer()
  const controller = new AbortController()
  const connection = {
    peer,
    channel: peer.channel,
    signal: controller.signal,
  } as unknown as SessionConnection

  return {
    app,
    fixture,
    peer,
    controller,
    connection,
    async cleanup() {
      app.unmount()
      fixture.restore()
      await app.cleanup()
    },
  }
}

test('audio hook captures microphone, recovers autoplay, and releases only its media', async () => {
  const { app, fixture, peer, connection, cleanup } = await setup()

  try {
    await act(async () => {
      await app.result.current.start(connection)
      app.result.current.toggleMute()
    })

    expect(app.result.current.muted).toBe(true)
    expect(fixture.track.enabled).toBe(false)
    FakeAudio.blocked = true

    await act(async () => {
      peer.dispatchEvent(
        Object.assign(new Event('track'), { streams: [{}], track: {} }),
      )
    })

    expect(app.result.current.audioReady).toBe(true)
    expect(app.result.current.audioPlaying).toBe(false)
    expect(app.result.current.error).toContain('Tap the orb')
    FakeAudio.blocked = false

    await act(async () => app.result.current.replayAudio())

    expect(app.result.current.audioPlaying).toBe(true)
    expect(app.result.current.error).toBeNull()

    await act(async () => app.result.current.end())

    expect(app.result.current.audioReady).toBe(false)
    expect(app.result.current.muted).toBe(false)
    expect(fixture.track.stopped).toBe(true)
    expect(peer.closed).toBe(false)
  } finally {
    await cleanup()
  }
})

test('session cancellation stops local tracks and ignores detached peer events', async () => {
  const { app, fixture, peer, connection, controller, cleanup } = await setup()

  try {
    await act(async () => app.result.current.start(connection))
    await act(async () => {
      controller.abort()
      peer.dispatchEvent(
        Object.assign(new Event('track'), { streams: [{}], track: {} }),
      )
    })

    expect(fixture.track.stopped).toBe(true)
    expect(app.result.current.audioReady).toBe(false)
    expect(peer.closed).toBe(false)
  } finally {
    await cleanup()
  }
})

test('unmount releases microphone without closing the session peer', async () => {
  const { app, fixture, peer, connection, cleanup } = await setup()

  try {
    await act(async () => app.result.current.start(connection))
    app.unmount()
    expect(fixture.track.stopped).toBe(true)
    expect(peer.closed).toBe(false)
  } finally {
    await cleanup()
  }
})

test('ending during permission releases late tracks and leaves replacement audio alone', async () => {
  const { app, fixture, connection, cleanup } = await setup()
  const original = fixture.media.getUserMedia
  let permission!: (stream: Awaited<ReturnType<typeof original>>) => void
  const lateTrack = {
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true
    },
  }
  fixture.media.getUserMedia = () =>
    new Promise((resolve) => {
      permission = resolve
    })

  try {
    let pending!: Promise<void>

    await act(async () => {
      pending = app.result.current.start(connection)
    })
    await act(async () => app.result.current.end())
    fixture.media.getUserMedia = original
    const replacementPeer = new FakePeer()
    const replacement = {
      peer: replacementPeer,
      channel: replacementPeer.channel,
      signal: new AbortController().signal,
    } as unknown as SessionConnection

    await act(async () => {
      await app.result.current.start(replacement)
      permission({
        getTracks: () => [lateTrack],
        getAudioTracks: () => [lateTrack],
      })
      await pending
    })

    expect(lateTrack.stopped).toBe(true)
    expect(fixture.track.stopped).toBe(false)
    expect(replacementPeer.closed).toBe(false)
  } finally {
    await cleanup()
  }
})

test('microphone denial exposes a readable error and releases listeners', async () => {
  const { app, fixture, peer, connection, cleanup } = await setup()
  fixture.media.getUserMedia = async () => {
    throw new DOMException('Denied', 'NotAllowedError')
  }

  try {
    await act(async () => {
      await expect(app.result.current.start(connection)).rejects.toThrow()
    })

    expect(app.result.current.error).toContain('Microphone access was denied')

    await act(async () => {
      peer.dispatchEvent(
        Object.assign(new Event('track'), { streams: [{}], track: {} }),
      )
    })

    expect(app.result.current.audioReady).toBe(false)
    expect(peer.closed).toBe(false)
  } finally {
    await cleanup()
  }
})

test('microphone meter samples input, respects mute, and stops on end', async () => {
  const { app, connection, cleanup } = await setup()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  let tick!: FrameRequestCallback
  let canceled = false
  let contextClosed = false
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: class {
      createAnalyser() {
        return {
          fftSize: 256,
          getByteTimeDomainData: (samples: Uint8Array) => samples.fill(140),
        }
      }
      createMediaStreamSource() {
        return { connect() {} }
      }
      async resume() {}
      async close() {
        contextClosed = true
      }
    },
  })
  window.requestAnimationFrame = (callback) => {
    tick = callback
    return 1
  }
  window.cancelAnimationFrame = () => {
    canceled = true
  }

  try {
    await act(async () => app.result.current.start(connection))
    await act(async () => tick(60))
    expect(app.result.current.inputLevel).toBeGreaterThan(0)

    await act(async () => app.result.current.toggleMute())
    await act(async () => tick(120))
    expect(app.result.current.inputLevel).toBe(0)

    await act(async () => app.result.current.end())
    expect(canceled).toBe(true)
    expect(contextClosed).toBe(true)
  } finally {
    if (previous) {
      Object.defineProperty(globalThis, 'AudioContext', previous)
    } else {
      Reflect.deleteProperty(globalThis, 'AudioContext')
    }

    await cleanup()
  }
})
