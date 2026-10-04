import { expect, spyOn, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { z } from 'zod'
import { readJSON, useApi } from '../hooks/api'
import { useAuth } from '../hooks/auth'
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
  const originalTimeout = globalThis.setTimeout
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay && delay >= 5_000) {
      timers.push({ callback, delay })
      return timers.length as unknown as ReturnType<typeof setTimeout>
    }

    return originalTimeout(callback, delay, ...args)
  }) as typeof setTimeout)
  const cache = new Map()
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => cache,
          dedupingInterval: 0,
          focusThrottleInterval: 0,
          isVisible: () => true,
          isOnline: () => true,
          refreshWhenHidden: true,
          refreshWhenOffline: true,
        }}
      >
        <AuthProvider>{children}</AuthProvider>
      </SWRConfig>
    )
  }
  const app = await renderAuthenticatedHook(
    () => ({ auth: useAuth(), send: useApi() }),
    undefined,
    {
      wrapper: Wrapper,
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
      timeout.mockRestore()
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

test('a late refresh cannot restore the session after logout', async () => {
  let completeRefresh!: (response: Response) => void
  let refreshes = 0
  const app = await fixture(async (path) => {
    if (path.endsWith('/logout')) {
      return new Response(null, { status: 204 })
    }

    if (++refreshes === 1) {
      return Response.json(session('old'))
    }

    return new Promise((resolve) => {
      completeRefresh = resolve
    })
  })

  try {
    let pending!: Promise<string>

    await act(async () => {
      pending = app.auth.getAccessToken('old')
      await Bun.sleep(0)
    })

    await act(async () => {
      await app.auth.logout()
    })

    await act(async () => {
      completeRefresh(Response.json(session('late')))
      await pending.catch(() => {})
    })

    expect(app.auth.isAuthenticated).toBe(false)
    await expect(app.auth.getAccessToken()).rejects.toThrow('Not authenticated')
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
    mode = 'unauthorized'
    await act(async () => {
      await app.auth.getAccessToken().catch(() => {})
      await Bun.sleep(5)
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
      await readJSON(
        await app.send({ path: '/test', method: 'GET' }),
        z.object({ ok: z.boolean() }),
      )
    })
    expect(refreshes).toBe(2)
    expect(requests).toBe(2)
    expect(await app.auth.getAccessToken()).toBe('new')
  } finally {
    await app.cleanup()
  }
})
