import { expect, spyOn, test } from 'bun:test'
import { act, fireEvent, within } from '@testing-library/react/pure'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { AuthContext } from '../auth/auth-provider'
import { browserFixture, FakePeer } from '../test-utils/audio-browser'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { VoicePage } from './voice-page'

function PageWrapper({ children }: { children: ReactNode }) {
  const cache = new Map()

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: true,
        isLoading: false,
        error: null,
        login: async () => {},
        logout: async () => {},
        getAccessToken: async () => 'token',
      }}
    >
      <SWRConfig
        value={{
          provider: () => cache,
          fallback: {
            '/v1/location': {
              latitude: 24.7,
              longitude: 46.7,
              accuracyMeters: 12,
            },
          },
        }}
      >
        <VoicePage />
        {children}
      </SWRConfig>
    </AuthContext.Provider>
  )
}

async function fixture(pendingCreation = false) {
  const id = crypto.randomUUID()
  let ended = false
  let finishEnd!: () => void
  let finishCreation!: () => void
  let sse!: ReadableStreamDefaultController<Uint8Array>
  let uiSignal: AbortSignal | null | undefined
  const calls: string[] = []
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (url: Parameters<typeof fetch>[0], input?: RequestInit) => {
        const path = String(url)
        calls.push(`${input?.method} ${path}`)

        if (path === '/v1/voice/sessions') {
          expect(JSON.parse(String(input?.body))).toEqual({ sdp: 'offer' })

          if (pendingCreation) {
            await new Promise<void>((resolve) => {
              finishCreation = resolve
            })
          }

          return Response.json({ id, sdp: 'answer' })
        }

        if (path.endsWith('/end')) {
          await new Promise<void>((resolve) => {
            finishEnd = resolve
          })
          ended = true
          return new Response(null, { status: 204 })
        }

        if (path.endsWith('/ui-events')) {
          uiSignal = input?.signal
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                sse = controller
              },
            }),
          )
        }

        return Response.json({
          id,
          status: ended ? 'ended' : 'connected',
          error: null,
          finalization: ended ? 'confirmed' : null,
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  let audio!: ReturnType<typeof browserFixture>
  const app = await renderAuthenticatedHook(() => null, undefined, {
    wrapper: PageWrapper,
    setup(browser) {
      Object.defineProperty(browser.navigator, 'permissions', {
        configurable: true,
        value: { query: async () => ({ state: 'prompt' }) },
      })
      audio = browserFixture({ preserveBrowser: true })
      Object.defineProperty(browser.navigator, 'mediaDevices', {
        configurable: true,
        value: audio.media,
      })
    },
  })
  const page = within(app.browser.document.body as unknown as HTMLElement)

  return {
    page,
    audio,
    calls,
    id,
    get uiSignal() {
      return uiSignal
    },
    finishCreation() {
      finishCreation()
    },
    finishEnd() {
      finishEnd()
    },
    sendCard() {
      sse.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: 'place-card',
            card: {
              id: crypto.randomUUID(),
              note: 'Nearby coffee',
              category: 'cafe',
              query: '',
              travelMode: 'WALK',
              places: [],
            },
          })}\n\n`,
        ),
      )
    },
    async cleanup() {
      await app.cleanup()
      audio.restore()
      request.mockRestore()
    },
  }
}

test('page starts audio, captions and cards, and closes media immediately on stop', async () => {
  const app = await fixture()

  try {
    await act(async () => {
      fireEvent.click(app.page.getByRole('button', { name: 'Start session' }))
      await Bun.sleep(10)
    })

    expect(FakePeer.current.remoteAnswer).toBe('answer')
    expect(app.calls).toContain(`GET /v1/voice/sessions/${app.id}/ui-events`)

    await act(async () => {
      FakePeer.current.channel.event({
        type: 'session.input_transcript.delta',
        delta: 'Hello there',
      })
      app.sendCard()
      await Bun.sleep(0)
    })

    expect(app.page.getByRole('log').textContent).toContain('Hello there')
    expect(app.page.getByText('Nearby coffee')).toBeDefined()

    await act(async () => {
      fireEvent.click(app.page.getByRole('button', { name: 'Stop session' }))
      await Bun.sleep(0)
    })

    expect(app.uiSignal?.aborted).toBe(true)
    expect(app.audio.track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
    expect(app.page.getByRole('log').textContent).toBe('')

    await act(async () => {
      app.finishEnd()
      await Bun.sleep(10)
    })

    expect(app.audio.track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
    expect(
      app.page.getByRole('button', { name: 'Start session' }),
    ).toBeDefined()
  } finally {
    await app.cleanup()
  }
})

test('stopping during session creation finalizes the late session without connecting audio or UI streams', async () => {
  const app = await fixture(true)

  try {
    await act(async () => {
      fireEvent.click(app.page.getByRole('button', { name: 'Start session' }))
      await Bun.sleep(10)
    })

    await act(async () => {
      fireEvent.click(app.page.getByRole('button', { name: 'Stop session' }))
      await Bun.sleep(0)
      app.finishCreation()
      await Bun.sleep(10)
    })

    expect(FakePeer.current.remoteAnswer).toBeUndefined()
    expect(app.calls.some((call) => call.endsWith('/ui-events'))).toBe(false)
    expect(app.calls).toContain(`POST /v1/voice/sessions/${app.id}/end`)
    expect(app.audio.track.stopped).toBe(true)

    await act(async () => {
      app.finishEnd()
      await Bun.sleep(10)
    })

    expect(app.audio.track.stopped).toBe(true)
    expect(FakePeer.current.closed).toBe(true)
  } finally {
    await app.cleanup()
  }
})

test('duplicate starts and stopping during microphone permission use the session signal', async () => {
  const app = await fixture()
  let allow!: (
    stream: Awaited<ReturnType<typeof app.audio.media.getUserMedia>>,
  ) => void
  const permission = spyOn(app.audio.media, 'getUserMedia').mockImplementation(
    () =>
      new Promise((resolve) => {
        allow = resolve
      }),
  )

  try {
    await act(async () => {
      const start = app.page.getByRole('button', { name: 'Start session' })
      fireEvent.click(start)
      fireEvent.click(start)
    })

    expect(permission).toHaveBeenCalledTimes(1)
    expect(app.calls).toHaveLength(0)

    await act(async () => {
      fireEvent.click(app.page.getByRole('button', { name: 'Stop session' }))
      await Bun.sleep(0)
      allow({
        getTracks: () => [app.audio.track],
        getAudioTracks: () => [app.audio.track],
      })
      await Bun.sleep(0)
    })

    expect(FakePeer.current.closed).toBe(true)
    expect(FakePeer.current.remoteAnswer).toBeUndefined()
    expect(app.audio.track.stopped).toBe(true)
    expect(app.calls).toHaveLength(0)
    expect(
      app.page.getByRole('button', { name: 'Start session' }),
    ).toBeDefined()
  } finally {
    permission.mockRestore()
    await app.cleanup()
  }
})
