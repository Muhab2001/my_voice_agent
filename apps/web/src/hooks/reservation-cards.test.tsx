import { expect, spyOn, test } from 'bun:test'
import { act } from '@testing-library/react/pure'
import type { reservationStateSchema } from '@voice/contracts'
import type { z } from 'zod'
import { floatingCardSchema } from '../cards/schema'
import { renderAuthenticatedHook } from '../test-utils/render-hook'
import { useFloatingCards } from './floating-cards'
import { useReservation } from './reservation'

type Reservation = z.infer<typeof reservationStateSchema>

function reservation(patch: Partial<Reservation> = {}): Reservation {
  return {
    id: crypto.randomUUID(),
    status: 'draft',
    hotelId: crypto.randomUUID(),
    hotel: 'Test Hotel',
    city: 'Riyadh',
    brand: 'Test',
    stayDate: '2026-10-01',
    guestName: 'Guest',
    rooms: [
      {
        offeringId: crypto.randomUUID(),
        name: 'Single',
        quantity: 1,
        unitPriceSar: 100,
        lineTotalSar: 100,
      },
    ],
    quotedTotalSar: 100,
    confirmedTotalSar: null,
    nextMissingField: null,
    reason: null,
    revision: 1,
    updatedAt: new Date().toISOString(),
    ...patch,
  }
}

function mockRequest(
  handler: (url: string, input?: RequestInit) => Promise<Response>,
) {
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      (url: Parameters<typeof fetch>[0], input?: RequestInit) =>
        handler(String(url), input),
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
}

test('reservation never fetches; incomplete confirmation stays local with readable errors', async () => {
  const request = mockRequest(async () => {
    throw new Error('Unexpected request')
  })
  const app = await renderAuthenticatedHook(
    useReservation,
    reservation({
      hotelId: null,
      stayDate: null,
      guestName: null,
      rooms: [],
      quotedTotalSar: null,
    }),
  )

  try {
    expect(request).not.toHaveBeenCalled()

    await act(async () => {
      await app.result.current.confirm().catch(() => {})
    })

    expect(request).not.toHaveBeenCalled()
    expect(app.result.current.error).toContain(
      'Choose a hotel before confirming.',
    )
    expect(app.result.current.error).toContain(
      'Choose a stay date before confirming.',
    )
    expect(app.result.current.error).toContain(
      'Enter a guest name before confirming.',
    )
    expect(app.result.current.error).toContain(
      'Choose at least one room before confirming.',
    )
    expect(app.result.current.isMutating).toBe(false)
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('confirmation posts only the existing ID and revision and holds the returned snapshot', async () => {
  const initial = reservation()
  const confirmed = {
    ...initial,
    status: 'confirmed' as const,
    revision: 2,
    confirmedTotalSar: 100,
  }
  const request = mockRequest(async (url, input) => {
    expect(url).toBe(`/v1/reservations/${initial.id}/confirm`)
    expect(input?.method).toBe('POST')
    expect(JSON.parse(String(input?.body))).toEqual({ revision: 1 })
    return Response.json(confirmed)
  })
  const app = await renderAuthenticatedHook(useReservation, initial)

  try {
    await act(async () => {
      await app.result.current.confirm()
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(app.result.current.state).toEqual(confirmed)
    expect(app.result.current.error).toBeNull()

    await act(async () => {
      app.rerender({ ...initial })
    })

    expect(app.result.current.state).toEqual(confirmed)
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('new tool snapshots win over a late confirmation response', async () => {
  const initial = reservation()
  let finish!: (response: Response) => void
  const request = mockRequest(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const app = await renderAuthenticatedHook(useReservation, initial)
  let pending!: ReturnType<typeof app.result.current.confirm>

  try {
    await act(async () => {
      pending = app.result.current.confirm()
      await Bun.sleep(0)
    })

    expect(app.result.current.isMutating).toBe(true)
    const newer = { ...initial, revision: 3, guestName: 'Updated Guest' }
    await act(async () => {
      app.rerender(newer)
    })

    await act(async () => {
      finish(Response.json({ ...initial, revision: 2, status: 'confirmed' }))
      await pending
    })

    expect(app.result.current.state).toEqual(newer)
    expect(app.result.current.isMutating).toBe(false)
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('a conflict uses the latest response snapshot without an active-reservation fetch', async () => {
  const initial = reservation()
  const latest = { ...initial, revision: 2, quotedTotalSar: 120 }
  const request = mockRequest(async () =>
    Response.json(
      {
        error: {
          code: 'conflict',
          message: 'The price changed. Review the new quote.',
          requestId: 'test',
        },
        latest,
      },
      { status: 409 },
    ),
  )
  const app = await renderAuthenticatedHook(useReservation, initial)

  try {
    await act(async () => {
      await app.result.current.confirm().catch(() => {})
    })

    expect(request).toHaveBeenCalledTimes(1)
    expect(app.result.current.state).toEqual(latest)
    expect(app.result.current.error).toBe(
      'The price changed. Review the new quote.',
    )
  } finally {
    await app.cleanup()
    request.mockRestore()
  }
})

test('floating cards coexist, update by identity, ignore older revisions, and dismiss by ID', async () => {
  const app = await renderAuthenticatedHook(useFloatingCards, undefined)
  const initial = reservation()
  const place = {
    id: crypto.randomUUID(),
    note: 'Coffee',
    category: 'cafe' as const,
    query: '',
    travelMode: 'WALK' as const,
    places: [],
  }

  try {
    await act(async () => {
      app.result.current.receive({
        type: 'reservation-state',
        reservation: initial,
      })
      app.result.current.receive({ type: 'place-card', card: place })
      app.result.current.receive({
        type: 'reservation-options',
        kind: 'hotels',
        options: [],
      })
      app.result.current.receive({
        type: 'reservation-options',
        kind: 'dates',
        options: [],
      })
    })

    expect(app.result.current.cards).toHaveLength(4)

    await act(async () => {
      app.result.current.receive({
        type: 'reservation-state',
        reservation: { ...initial, revision: 3 },
      })
      app.result.current.receive({
        type: 'reservation-state',
        reservation: { ...initial, revision: 2 },
      })
      app.result.current.receive({
        type: 'reservation-options',
        kind: 'hotels',
        options: { message: 'No hotels found' },
      })
    })

    expect(app.result.current.cards).toHaveLength(4)
    expect(app.result.current.cards[0]).toMatchObject({
      reservation: { revision: 3 },
    })
    expect(app.result.current.cards[2]).toMatchObject({
      suggestions: { options: { message: 'No hotels found' } },
    })

    await act(async () => {
      app.result.current.dismiss(`places:${place.id}`)
    })

    expect(app.result.current.cards).toHaveLength(3)
    expect(
      app.result.current.cards.some((card) => card.id === `places:${place.id}`),
    ).toBe(false)

    await act(async () => {
      app.result.current.clear()
    })

    expect(app.result.current.cards).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('card schema rejects options that do not match their declared kind', () => {
  expect(
    floatingCardSchema.safeParse({
      id: 'suggestions:hotels',
      type: 'suggestions',
      suggestions: {
        kind: 'hotels',
        options: [{ date: '2026-10-01', availableRooms: 5 }],
      },
    }).success,
  ).toBe(false)
})
