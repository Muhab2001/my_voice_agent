import { expect, spyOn, test } from 'bun:test'
import { ApiClient } from '../lib/api-client'
import type { VoiceUiEvent } from './types'
import { VoiceUiEventStream } from './voice-ui-event-stream'

test('UI stream validates and delivers location, place, and reservation events', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  const request = spyOn(ApiClient, 'stream').mockResolvedValue(
    new Response(body),
  )
  const events: VoiceUiEvent[] = []
  const errors: string[] = []
  const stream = new VoiceUiEventStream({
    onEvent: (event) => events.push(event),
    onError: (message) => errors.push(message),
  })
  const sessionId = crypto.randomUUID()
  const requestId = crypto.randomUUID()

  try {
    await stream.start(sessionId)
    expect(request).toHaveBeenCalledWith(
      `/v1/voice/sessions/${sessionId}/ui-events`,
      expect.any(AbortSignal),
    )
    const encoder = new TextEncoder()
    const send = (value: string) => controller.enqueue(encoder.encode(value))
    send('data: {broken}\n\n')
    send('data: {"type":"unknown"}\n\n')
    send('data: {"type":"location-request",')
    send(`"requestId":"${requestId}"}\n\n`)
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
      'location-request',
      'place-card',
      'reservation-state',
      'reservation-options',
    ])
    expect(errors).toEqual([])
    stream.stop()
    expect(request.mock.calls[0]?.[1].aborted).toBe(true)
    await Bun.sleep(0)
    expect(errors).toEqual([])
  } finally {
    stream.stop()
    request.mockRestore()
  }
})

test('UI stream reports a failed SSE connection without affecting voice transport', async () => {
  const request = spyOn(ApiClient, 'stream').mockRejectedValue(
    new Error('Connection failed'),
  )
  const errors: string[] = []
  const stream = new VoiceUiEventStream({
    onEvent: () => {},
    onError: (message) => errors.push(message),
  })

  try {
    await stream.start(crypto.randomUUID())
    expect(errors).toEqual(['Live updates could not connect.'])
  } finally {
    stream.stop()
    request.mockRestore()
  }
})
