import { expect, mock, test } from 'bun:test'
import type { UIEvent } from './ui-event-stream'
import { UIEventStream } from './ui-event-stream'

test('UI stream validates and delivers place and reservation events', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  const request = mock(
    async (_input: import('../lib/http').HttpRequestInput) =>
      new Response(body),
  )
  const events: UIEvent[] = []
  const errors: string[] = []
  const stream = new UIEventStream(
    {
      onEvent: (event) => events.push(event),
      onError: (message) => errors.push(message),
    },
    request,
  )
  const sessionId = crypto.randomUUID()

  try {
    await stream.start(sessionId)
    expect(request).toHaveBeenCalledWith({
      path: `/v1/voice/sessions/${sessionId}/ui-events`,
      method: 'GET',
      signal: expect.any(AbortSignal),
    })
    const encoder = new TextEncoder()
    const send = (value: string) => controller.enqueue(encoder.encode(value))
    send('data: {broken}\n\n')
    send('data: {"type":"unknown"}\n\n')
    send(
      `data: ${JSON.stringify({
        type: 'place-card',
        card: {
          id: crypto.randomUUID(),
          note: 'Nearby coffee',
          category: 'cafe',
          query: '',
          travelMode: 'WALK',
          places: [
            {
              name: 'Test Cafe',
              address: 'Main Street',
              url: 'https://maps.google.com',
              distanceMeters: 100,
              durationSeconds: 60,
            },
          ],
        },
      })}\n\n`,
    )
    send(
      `data: ${JSON.stringify({
        type: 'reservation-state',
        reservation: {
          id: crypto.randomUUID(),
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
    )
    send(
      `data: ${JSON.stringify({
        type: 'reservation-options',
        kind: 'hotels',
        options: [
          {
            id: crypto.randomUUID(),
            brandName: 'Marriott',
            locationName: 'Marriott - Riyadh',
            city: 'Riyadh',
          },
        ],
      })}\n\n`,
    )
    await Bun.sleep(0)
    expect(events.map((event) => event.type)).toEqual([
      'place-card',
      'reservation-state',
      'reservation-options',
    ])
    expect(errors).toEqual([])
    stream.end()
    expect(request.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    await Bun.sleep(0)
    expect(errors).toEqual([])
  } finally {
    stream.end()
  }
})

test('UI stream reports a failed SSE connection without affecting other streams', async () => {
  const request = mock(async () => {
    throw new Error('Connection failed')
  })
  const errors: string[] = []
  const stream = new UIEventStream(
    {
      onEvent: () => {},
      onError: (message) => errors.push(message),
    },
    request,
  )

  try {
    await stream.start(crypto.randomUUID())
    expect(errors).toEqual(['Live updates could not connect.'])
  } finally {
    stream.end()
  }
})

test('ending a stream suppresses a chunk already queued for delivery', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const events: UIEvent[] = []
  const errors: string[] = []
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  const stream = new UIEventStream(
    {
      onEvent: (event) => events.push(event),
      onError: (message) => errors.push(message),
    },
    async () => new Response(body),
  )

  await stream.start('session')
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
  stream.end()
  await Bun.sleep(0)

  expect(events).toEqual([])
  expect(errors).toEqual([])
})

test('ending while connecting suppresses a late connection failure', async () => {
  let reject!: (reason: Error) => void
  const errors: string[] = []
  const stream = new UIEventStream(
    {
      onEvent: () => {},
      onError: (message) => errors.push(message),
    },
    () =>
      new Promise<Response>((_resolve, fail) => {
        reject = fail
      }),
  )
  const pending = stream.start('session')
  stream.end()
  reject(new Error('Late failure'))
  await pending

  expect(errors).toEqual([])
})
