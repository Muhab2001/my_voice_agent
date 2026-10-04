import { expect, spyOn, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { useFloatingCards } from './floating-cards'
import { useUIEventStream } from './ui-event-stream'

function useCardsStream() {
  const cards = useFloatingCards()
  const ui = useUIEventStream(cards.receive)
  return { cards, ui }
}

test('UI events populate the card hook, validate input, and stop without dismissing cards', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let signal: AbortSignal | null | undefined
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (_url: Parameters<typeof fetch>[0], input?: RequestInit) => {
        signal = input?.signal
        return new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value
            },
          }),
        )
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const app = await renderAuthenticatedHook(useCardsStream, undefined)
  const id = crypto.randomUUID()
  const reservationId = crypto.randomUUID()

  try {
    expect(request).not.toHaveBeenCalled()

    await act(async () => {
      await app.result.current.ui.start('session')
    })

    await act(async () => {
      controller.enqueue(
        new TextEncoder().encode('data: {"type":"unknown"}\n\n'),
      )
      const frame = `data: ${JSON.stringify({
        type: 'place-card',
        card: {
          id,
          note: 'Nearby coffee',
          category: 'cafe',
          query: '',
          travelMode: 'WALK',
          places: [],
        },
      })}\n\n`
      const halfway = Math.floor(frame.length / 2)
      controller.enqueue(new TextEncoder().encode(frame.slice(0, halfway)))
      controller.enqueue(new TextEncoder().encode(frame.slice(halfway)))
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({
            type: 'reservation-state',
            reservation: {
              id: reservationId,
              status: 'draft',
              hotelId: null,
              hotel: null,
              city: null,
              brand: null,
              stayDate: null,
              guestName: null,
              rooms: [],
              quotedTotalSar: null,
              confirmedTotalSar: null,
              nextMissingField: 'hotel',
              reason: null,
              revision: 1,
              updatedAt: new Date().toISOString(),
            },
          })}\n\n`,
        ),
      )
      await Bun.sleep(0)
    })

    expect(app.result.current.cards.cards).toHaveLength(2)
    expect(app.result.current.cards.cards[0]?.id).toBe(`places:${id}`)
    expect(app.result.current.cards.cards[1]?.id).toBe(
      `reservation:${reservationId}`,
    )

    await act(async () => {
      app.result.current.ui.end()
    })

    expect(signal?.aborted).toBe(true)
    expect(app.result.current.cards.cards).toHaveLength(2)
    expect(app.result.current.ui.error).toBeNull()

    await act(async () => {
      app.result.current.cards.dismiss(`places:${id}`)
    })

    expect(app.result.current.cards.cards).toHaveLength(1)
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('UI hook reports connection failures and clears them on stop', async () => {
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async () => {
        throw new TypeError('Offline')
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const app = await renderAuthenticatedHook(useCardsStream, undefined)

  try {
    await act(async () => {
      await app.result.current.ui.start('session')
    })

    expect(app.result.current.ui.error).toBe('Live updates could not connect.')
    expect(app.result.current.cards.cards).toEqual([])

    await act(async () => {
      app.result.current.ui.end()
    })

    expect(app.result.current.ui.error).toBeNull()
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('restarting and unmounting cancel each UI stream without reporting stale errors', async () => {
  const signals: (AbortSignal | null | undefined)[] = []
  const rejectRequests: ((reason: Error) => void)[] = []
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (_url: Parameters<typeof fetch>[0], input?: RequestInit) => {
        signals.push(input?.signal)
        return new Promise<Response>((_resolve, reject) => {
          rejectRequests.push(reject)
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const app = await renderAuthenticatedHook(useCardsStream, undefined)

  try {
    let first!: Promise<void>
    let second!: Promise<void>

    await act(async () => {
      first = app.result.current.ui.start('first')
      second = app.result.current.ui.start('second')
      await Bun.sleep(0)
    })

    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    await act(async () => {
      rejectRequests[0]?.(new Error('Old connection failed'))
      await first
    })

    expect(app.result.current.ui.error).toBeNull()
    await app.cleanup()
    expect(signals[1]?.aborted).toBe(true)
    rejectRequests[1]?.(new Error('Unmounted connection failed'))
    await second
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('ending a stream suppresses a queued event', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const request = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value
            },
          }),
        ),
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const app = await renderAuthenticatedHook(useCardsStream, undefined)

  try {
    await act(async () => {
      await app.result.current.ui.start('session')
    })

    controller.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({
          type: 'place-card',
          card: {
            id: crypto.randomUUID(),
            note: '',
            category: 'cafe',
            query: '',
            travelMode: 'WALK',
            places: [],
          },
        })}\n\n`,
      ),
    )

    await act(async () => {
      app.result.current.ui.end()
      await Bun.sleep(0)
    })

    expect(app.result.current.cards.cards).toEqual([])
    expect(app.result.current.ui.error).toBeNull()
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})
