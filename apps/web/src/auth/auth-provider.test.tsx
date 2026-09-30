import { expect, spyOn, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import { useAuth } from '../hooks/use-auth'
import { useAuthenticatedFetch } from '../hooks/use-authenticated-fetch'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { AuthProvider } from './auth-provider'

function session(token: string, ttl = 15 * 60_000) {
  return {
    accessToken: token,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
  }
}

async function fixture(
  handler: (path: string, input?: RequestInit) => Promise<Response>,
) {
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (url: Parameters<typeof fetch>[0], input?: RequestInit) =>
        handler(String(url), input),
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const timers: { callback: () => void; delay: number }[] = []
  let restoreTimeout!: () => void
  const app = await renderAuthenticatedHook(
    () => ({ auth: useAuth(), send: useAuthenticatedFetch() }),
    undefined,
    {
      wrapper: AuthProvider,
      setup: (browser) => {
        const timeout = spyOn(browser, 'setTimeout').mockImplementation(
          (callback, delay) => {
            timers.push({ callback: callback as () => void, delay: delay ?? 0 })
            return timers.length as unknown as ReturnType<
              typeof browser.setTimeout
            >
          },
        )
        restoreTimeout = () => timeout.mockRestore()
      },
    },
  )

  return {
    get auth() {
      return app.result.current.auth
    },
    get send() {
      return app.result.current.send
    },
    request,
    timers,
    async cleanup() {
      await app.cleanup()
      request.mockRestore()
      restoreTimeout()
    },
  }
}

test('restoration updates React and fresh tokens do not cause another refresh', async () => {
  const app = await fixture(async () => Response.json(session('restored')))

  try {
    expect(app.auth.isAuthenticated).toBe(true)
    expect(await app.auth.getAccessToken()).toBe('restored')
    expect(app.request).toHaveBeenCalledTimes(1)
    expect(app.timers.at(-1)?.delay).toBeGreaterThan(13 * 60_000)
    expect(app.timers.at(-1)?.delay).toBeLessThanOrEqual(14 * 60_000)
  } finally {
    await app.cleanup()
  }
})

test('near-expiry tokens refresh and React exposes the updated callback', async () => {
  let calls = 0
  const app = await fixture(async () =>
    Response.json(
      session(
        ++calls === 1 ? 'old' : 'new',
        calls === 1 ? 30_000 : 15 * 60_000,
      ),
    ),
  )

  try {
    await act(async () => {
      expect(await app.auth.getAccessToken()).toBe('new')
    })

    expect(await app.auth.getAccessToken()).toBe('new')
    expect(app.request).toHaveBeenCalledTimes(2)
  } finally {
    await app.cleanup()
  }
})

test('passive refresh publishes a new token and reschedules the timer', async () => {
  let calls = 0
  const app = await fixture(async () =>
    Response.json(session(++calls === 1 ? 'old' : 'new')),
  )

  try {
    await act(async () => {
      app.timers.at(-1)?.callback()
    })
    expect(await app.auth.getAccessToken()).toBe('new')
    expect(app.timers).toHaveLength(2)
  } finally {
    await app.cleanup()
  }
})

test('login and logout update the session through React state', async () => {
  const app = await fixture(async (path) => {
    if (path.endsWith('/login')) {
      return Response.json(session('login'))
    }

    return new Response(null, { status: path.endsWith('/logout') ? 204 : 401 })
  })

  try {
    expect(app.auth.isAuthenticated).toBe(false)
    await act(async () => {
      await app.auth.login('password')
    })
    expect(await app.auth.getAccessToken()).toBe('login')
    await act(async () => {
      await app.auth.logout()
    })
    expect(app.auth.isAuthenticated).toBe(false)
    await expect(app.auth.getAccessToken()).rejects.toThrow('Not authenticated')
  } finally {
    await app.cleanup()
  }
})

test('refresh network failures preserve the session and retry; a 401 signs out', async () => {
  let mode: 'success' | 'offline' | 'unauthorized' = 'success'
  const app = await fixture(async () => {
    if (mode === 'offline') {
      throw new TypeError('Offline')
    }

    if (mode === 'unauthorized') {
      return new Response(null, { status: 401 })
    }

    return Response.json(session('old', 30_000))
  })

  try {
    mode = 'offline'
    await act(async () => {
      await app.auth.getAccessToken().catch(() => {})
    })
    expect(app.auth.isAuthenticated).toBe(true)
    expect(app.auth.error?.message).toBe('Offline')
    expect(app.timers.at(-1)?.delay).toBe(5_000)
    mode = 'unauthorized'
    await act(async () => {
      app.timers.at(-1)?.callback()
    })
    expect(app.auth.isAuthenticated).toBe(false)
  } finally {
    await app.cleanup()
  }
})

test('authenticated hook retries a rejected token and updates provider state', async () => {
  let refreshes = 0
  let requests = 0
  const app = await fixture(async (path) => {
    if (path.endsWith('/refresh')) {
      return Response.json(session(++refreshes === 1 ? 'old' : 'new'))
    }

    return ++requests === 1
      ? new Response(null, { status: 401 })
      : Response.json({ ok: true })
  })

  try {
    await act(async () => {
      await app.send({ path: '/test', method: 'GET' })
    })
    expect(refreshes).toBe(2)
    expect(requests).toBe(2)
    expect(await app.auth.getAccessToken()).toBe('new')
  } finally {
    await app.cleanup()
  }
})
