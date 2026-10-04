import { expect, spyOn, test } from 'bun:test'
import { act, waitFor } from '@testing-library/react/pure'
import { browserFixture, FakePeer } from '../test-utils/audio-browser'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { useSessionManager } from './session-manager'

const id = '00000000-0000-4000-8000-000000000001'

async function renderSessionHook(
  options: Parameters<typeof renderAuthenticatedHook>[2] = {},
) {
  let fixture!: ReturnType<typeof browserFixture>
  const app = await renderAuthenticatedHook(useSessionManager, undefined, {
    ...options,
    setup: () => {
      fixture = browserFixture({ preserveBrowser: true })
    },
  })
  let connection!: NonNullable<ReturnType<typeof app.result.current.prepare>>

  await act(async () => {
    const prepared = app.result.current.prepare()

    if (!prepared) {
      throw new Error('Session connection was not prepared.')
    }

    connection = prepared
  })

  return {
    ...app,
    connection,
    async cleanup() {
      await app.cleanup()
      fixture.restore()
    },
  }
}

function status(finalization = 'confirmed', error: string | null = null) {
  return Response.json({ id, status: 'active', finalization, error })
}

test('session manager owns negotiation and closes its connection before API finalization', async () => {
  const original = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input, init) => {
    const path = String(input)
    requests.push(`${init?.method} ${path}`)

    if (path.endsWith('/end')) {
      expect(FakePeer.current.closed).toBe(true)
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      expect(JSON.parse(String(init.body))).toEqual({ sdp: 'offer' })
      return Response.json({ id, sdp: 'answer' })
    }

    return status()
  }) as typeof fetch
  const app = await renderSessionHook()
  const connection = FakePeer.current.channel
  const closePeer = spyOn(FakePeer.current, 'close')
  const closeChannel = spyOn(connection, 'close')

  try {
    await act(async () => {
      expect(await app.result.current.start()).toEqual({ id, sdp: 'answer' })
      connection.event({ type: 'session.started' })
    })

    expect(app.result.current.id).toBe(id)
    expect(app.result.current.status).toBe('connected')
    expect(FakePeer.current.remoteAnswer).toBe('answer')
    expect(app.result.current.prepare()).toBeNull()
    expect(app.connection.peer).toBe(
      FakePeer.current as unknown as RTCPeerConnection,
    )
    expect(app.connection.channel).toBe(connection as unknown as RTCDataChannel)

    await act(async () => {
      connection.event({
        type: 'session.input_transcript.delta',
        delta: 'Hello',
      })
    })

    expect(app.result.current.status).toBe('connected')

    await act(async () => {
      await app.result.current.end()
      await app.result.current.end()
      connection.event({ type: 'session.started' })
    })

    expect(app.result.current.status).toBe('idle')
    expect(app.result.current.id).toBeNull()
    expect(app.connection.signal.aborted).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
    expect(closePeer).toHaveBeenCalledTimes(1)
    expect(closeChannel).toHaveBeenCalledTimes(1)
    expect(requests.slice(-2)).toEqual([
      `POST /v1/voice/sessions/${id}/end`,
      `GET /v1/voice/sessions/${id}`,
    ])
  } finally {
    await app.cleanup()
    closePeer.mockRestore()
    closeChannel.mockRestore()
    globalThis.fetch = original
  }
})

test('ending during creation closes the late session and never publishes its id', async () => {
  const original = globalThis.fetch
  let resolve!: (response: Response) => void
  let ended = false
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/end')) {
      ended = true
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      return new Promise<Response>((done) => {
        resolve = done
      })
    }

    return status()
  }) as typeof fetch
  const app = await renderSessionHook()

  try {
    await act(async () => {
      const starting = app.result.current.start()
      await new Promise((done) => setTimeout(done, 0))
      const ending = app.result.current.end()
      expect(app.connection.signal.aborted).toBe(true)
      expect(FakePeer.current.closed).toBe(true)
      resolve(Response.json({ id, sdp: 'answer' }))
      expect(await starting).toBeNull()
      await ending
    })

    expect(ended).toBe(true)
    expect(app.result.current.id).toBeNull()
    expect(app.result.current.status).toBe('idle')
  } finally {
    await app.cleanup()
    globalThis.fetch = original
  }
})

test('finalization failure is readable and provider closure is not mistaken for connection loss', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/end')) {
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      return Response.json({ id, sdp: 'answer' })
    }

    return status('unconfirmed')
  }) as typeof fetch
  const app = await renderSessionHook()
  const connection = FakePeer.current.channel

  try {
    await act(async () => {
      await app.result.current.start()
      connection.event({ type: 'session.closed', reason: 'completed' })
      connection.dispatchEvent(new Event('close'))
    })

    expect(app.result.current.status).toBe('ended')
    expect(app.result.current.error).toBeNull()

    await act(async () => {
      await app.result.current.end()
    })

    expect(app.result.current.error).toBe(
      'Session finalization could not be confirmed.',
    )
  } finally {
    await app.cleanup()
    globalThis.fetch = original
  }
})

test('refreshing the authentication callback keeps the active session open', async () => {
  const original = globalThis.fetch
  let ended = false
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/end')) {
      ended = true
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      return Response.json({ id, sdp: 'answer' })
    }

    return status()
  }) as typeof fetch
  const { AuthContext } = await import('../auth/auth-provider')
  const { SWRConfig } = await import('swr')
  const cache = new Map()
  const Wrapper = ({ children }: { children: import('react').ReactNode }) => (
    <AuthContext.Provider
      value={{
        isAuthenticated: true,
        isLoading: false,
        error: null,
        login: async () => {},
        logout: async () => {},
        getAccessToken: async () => 'refreshed-token',
      }}
    >
      <SWRConfig value={{ provider: () => cache }}>{children}</SWRConfig>
    </AuthContext.Provider>
  )
  const app = await renderSessionHook({ wrapper: Wrapper })

  try {
    await act(async () => {
      await app.result.current.start()
    })

    app.rerender()
    await act(async () => {})

    expect(ended).toBe(false)
    expect(app.result.current.id).toBe(id)
  } finally {
    await app.cleanup()
    globalThis.fetch = original
  }
})

test('session polling exposes tool errors and server failure status', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async (_input, init) => {
    if (init?.method === 'POST') {
      return Response.json({ id, sdp: 'answer' })
    }

    return Response.json({
      id,
      status: 'failed',
      error: 'The hotel tool failed.',
      finalization: 'unconfirmed',
    })
  }) as typeof fetch
  const app = await renderSessionHook()

  try {
    await act(async () => {
      await app.result.current.start()
    })

    await waitFor(() => {
      expect(app.result.current.status).toBe('failed')
      expect(app.result.current.error).toBe('The hotel tool failed.')
    })
  } finally {
    await app.cleanup()
    globalThis.fetch = original
  }
})

test('three consecutive status failures mark the session failed', async () => {
  const original = globalThis.fetch
  const random = spyOn(Math, 'random').mockReturnValue(0)
  let attempts = 0
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/end')) {
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      return Response.json({ id, sdp: 'answer' })
    }

    attempts += 1
    throw new Error('Offline')
  }) as typeof fetch
  const app = await renderSessionHook()

  try {
    await act(async () => {
      await app.result.current.start()
    })

    await waitFor(
      () => {
        expect(app.result.current.status).toBe('failed')
        expect(app.result.current.error).toBe(
          'Could not reach the voice server.',
        )
      },
      { timeout: 10_000 },
    )

    expect(attempts).toBe(3)
  } finally {
    await app.cleanup()
    globalThis.fetch = original
    random.mockRestore()
  }
}, 15_000)

test('Stop releases after the deadline and finalizes a session whose creation resolves later', async () => {
  const original = globalThis.fetch
  const originalTimer = globalThis.setTimeout
  let deadline!: () => void
  const timer = spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: () => void,
    duration?: number,
    ...args: unknown[]
  ) => {
    if (duration === 12_000) {
      deadline = handler
      return originalTimer(() => {}, 120_000)
    }

    return originalTimer(handler, duration, ...args)
  }) as typeof setTimeout)
  let resolve!: (response: Response) => void
  let endedCount = 0
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/end')) {
      endedCount += 1
      return new Response(null, { status: 204 })
    }

    if (init?.method === 'POST') {
      return new Promise<Response>((done) => {
        resolve = done
      })
    }

    return status()
  }) as typeof fetch
  const app = await renderSessionHook()

  try {
    let starting!: ReturnType<typeof app.result.current.start>

    await act(async () => {
      starting = app.result.current.start()
      await new Promise((done) => originalTimer(done, 0))
      const ending = app.result.current.end()
      await Promise.resolve()
      deadline()
      await ending
    })

    expect(app.result.current.status).toBe('idle')
    expect(app.result.current.error).toBe(
      'Session finalization could not be confirmed.',
    )

    await expect(app.result.current.start()).rejects.toThrow(
      'The previous session is still closing. Please wait.',
    )

    await act(async () => {
      resolve(Response.json({ id, sdp: 'answer' }))
      expect(await starting).toBeNull()
    })

    expect(endedCount).toBe(1)
    expect(app.result.current.id).toBeNull()
  } finally {
    await app.cleanup()
    globalThis.fetch = original
    timer.mockRestore()
  }
})

test('Stop cancels ICE gathering without creating a remote session', async () => {
  const original = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input) => {
    requests.push(String(input))
    return Response.json({ id, sdp: 'answer' })
  }) as typeof fetch
  const app = await renderSessionHook()
  const peer = FakePeer.current
  peer.iceGatheringState = 'gathering'
  const removeListener = spyOn(peer, 'removeEventListener')

  try {
    let starting!: ReturnType<typeof app.result.current.start>

    await act(async () => {
      starting = app.result.current.start()
      await new Promise((done) => setTimeout(done, 0))
      await app.result.current.end()
      expect(await starting).toBeNull()
    })

    expect(requests).toEqual([])
    expect(app.connection.signal.aborted).toBe(true)
    expect(peer.closed).toBe(true)
    expect(
      removeListener.mock.calls.some(
        ([name]) => name === 'icegatheringstatechange',
      ),
    ).toBe(true)
    expect(app.result.current.status).toBe('idle')
  } finally {
    await app.cleanup()
    removeListener.mockRestore()
    globalThis.fetch = original
  }
})

test('Stop during offer generation closes the peer and prevents SDP submission', async () => {
  const original = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input) => {
    requests.push(String(input))
    return Response.json({ id, sdp: 'answer' })
  }) as typeof fetch
  const app = await renderSessionHook()
  const peer = FakePeer.current
  let resolveOffer!: (offer: { type: 'offer'; sdp: string }) => void
  const offer = spyOn(peer, 'createOffer').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveOffer = resolve
      }),
  )
  const localDescription = spyOn(peer, 'setLocalDescription')

  try {
    await act(async () => {
      const starting = app.result.current.start()
      await Promise.resolve()
      const ending = app.result.current.end()
      expect(app.connection.signal.aborted).toBe(true)
      expect(peer.closed).toBe(true)
      resolveOffer({ type: 'offer', sdp: 'offer' })
      expect(await starting).toBeNull()
      await ending
    })

    expect(requests).toEqual([])
    expect(localDescription).not.toHaveBeenCalled()
    expect(app.result.current.status).toBe('idle')
  } finally {
    await app.cleanup()
    offer.mockRestore()
    localDescription.mockRestore()
    globalThis.fetch = original
  }
})
