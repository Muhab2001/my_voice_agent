import { expect, spyOn, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { useLocationTracking } from './location-tracking'

async function fixture(permission: PermissionState = 'prompt') {
  let denied = false
  let offline = false
  let latitude = 24.7
  let positions = 0
  const saved: unknown[] = []
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_url: Parameters<typeof fetch>[0], input?: RequestInit) => {
        if (offline) {
          throw new TypeError('Offline')
        }

        saved.push(JSON.parse(String(input?.body)))
        expect(new Headers(input?.headers).get('authorization')).toBe(
          'Bearer token',
        )
        return new Response(null, { status: 204 })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const timers: (() => void)[] = []
  const schedule = globalThis.setTimeout
  const timeout = spyOn(globalThis, 'setTimeout').mockImplementation(((
    callback: () => void,
    delay?: number,
    ...args: unknown[]
  ) => {
    const timer = schedule(callback, delay, ...args)

    if (delay === 10 * 60_000) {
      timers.push(() => {
        clearTimeout(timer)
        callback()
      })
    }

    return timer
  }) as typeof setTimeout)
  const app = await renderAuthenticatedHook(
    () => ({ ...useLocationTracking() }),
    undefined,
    {
      config: {
        dedupingInterval: 0,
        isVisible: () => true,
        isOnline: () => true,
      },
      setup: (browser) => {
        Object.defineProperty(browser.navigator, 'permissions', {
          configurable: true,
          value: { query: async () => ({ state: permission }) },
        })
        Object.defineProperty(browser.navigator, 'geolocation', {
          configurable: true,
          value: {
            getCurrentPosition(
              success: PositionCallback,
              failure: PositionErrorCallback,
            ) {
              positions += 1

              if (denied) {
                failure({
                  code: 1,
                  message: 'Permission denied',
                } as GeolocationPositionError)
                return
              }

              success({
                coords: { latitude, longitude: 46.7, accuracy: 12 },
              } as GeolocationPosition)
            },
          },
        })
      },
    },
  )

  return {
    get location() {
      return app.result.current
    },
    get positions() {
      return positions
    },
    saved,
    timers,
    deny(value: boolean) {
      denied = value
    },
    offline(value: boolean) {
      offline = value
    },
    move(value: number) {
      latitude = value
    },
    async cleanup() {
      await app.cleanup()
      request.mockRestore()
      timeout.mockRestore()
    },
  }
}

test('location waits for acceptance, saves immediately, and polls fresh coordinates', async () => {
  const app = await fixture()

  try {
    expect(app.positions).toBe(0)
    expect(app.timers).toHaveLength(0)
    expect(app.location.data).toBeUndefined()
    expect(app.location.error).toBeUndefined()

    await act(async () => {
      await app.location.mutate()
    })

    expect(app.saved).toEqual([
      { latitude: 24.7, longitude: 46.7, accuracyMeters: 12 },
    ])
    expect(app.location.data).toBeDefined()
    expect(app.location.error).toBeUndefined()
    expect(app.timers.length).toBeGreaterThan(0)
    app.move(25)
    await Bun.sleep(5)

    await act(async () => {
      app.timers.at(-1)?.()
      await Bun.sleep(5)
    })

    expect(app.saved.at(-1)).toEqual({
      latitude: 25,
      longitude: 46.7,
      accuracyMeters: 12,
    })
    expect(app.positions).toBe(2)
  } finally {
    await app.cleanup()
  }
})

test('denied permission and save failures keep access blocked until a successful retry', async () => {
  const app = await fixture()

  try {
    app.deny(true)

    await act(async () => {
      await app.location.mutate().catch(() => {})
    })

    expect(app.location.error).toBeDefined()
    expect(app.saved).toHaveLength(0)
    expect(app.timers).toHaveLength(0)
    app.deny(false)
    app.offline(true)

    await act(async () => {
      await app.location.mutate().catch(() => {})
    })

    expect(app.location.data).toBeUndefined()
    expect(app.location.error).toBeDefined()
    app.offline(false)

    await act(async () => {
      await app.location.mutate()
    })

    expect(app.location.data).toBeDefined()
    expect(app.location.error).toBeUndefined()
    app.deny(true)
    await Bun.sleep(5)

    await act(async () => {
      app.timers.at(-1)?.()
      await Bun.sleep(5)
    })

    expect(app.location.error).toBeDefined()
    app.deny(false)

    await act(async () => {
      await app.location.mutate()
    })

    expect(app.location.data).toBeDefined()
    expect(app.location.error).toBeUndefined()
  } finally {
    await app.cleanup()
  }
})

test('previously granted location permission saves automatically without requiring acceptance', async () => {
  const app = await fixture('granted')

  try {
    expect(app.location.permission).toBe('granted')
    expect(app.positions).toBe(1)
    expect(app.location.data).toBeDefined()
    expect(app.saved).toHaveLength(1)
  } finally {
    await app.cleanup()
  }
})
