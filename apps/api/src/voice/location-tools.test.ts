import { expect, test } from 'bun:test'
import type { LocationStore, SavedLocation } from '@voice/database'
import type { PlacesService } from './places.js'
import { executeLocationTool } from './tools.js'
import { UIEventChannel } from './ui-event-channel.js'

const args = JSON.stringify({
  category: 'cafe',
  search_query: null,
  radius_meters: 1200,
  travel_mode: 'WALK',
  note: 'A few coffee spots for your short break.',
})

test('nearby tool emits its card without storing it on the server', async () => {
  const saved: SavedLocation = {
    latitude: 24.7,
    longitude: 46.7,
    accuracyMeters: 20,
    recordedAt: new Date('2020-01-01T00:00:00Z'),
  }
  const location: LocationStore = {
    latest: async () => saved,
    save: async () => {
      throw new Error('unexpected save')
    },
  }
  const places: PlacesService = {
    nearby: async () => [
      {
        name: 'Test Cafe',
        address: 'Main Street',
        url: 'https://maps.google.com/?q=Test+Cafe',
        distanceMeters: 450,
        durationSeconds: 360,
      },
    ],
  }
  const ui = new UIEventChannel()
  const events: unknown[] = []
  const sessionId = crypto.randomUUID()
  ui.subscribe(
    sessionId,
    (event) => events.push(event),
    () => {},
  )
  const result = await executeLocationTool(
    location,
    places,
    ui,
    sessionId,
    'find_nearby_places',
    args,
  )

  expect(result).toHaveProperty('places')
  expect(events).toHaveLength(1)
  expect(events[0]).toHaveProperty('type', 'place-card')
})

test('hotel, park, and other searches accept a wider radius and publish distinct cards', async () => {
  const saved: SavedLocation = {
    latitude: 24.7,
    longitude: 46.7,
    accuracyMeters: 20,
    recordedAt: new Date(),
  }
  const location: LocationStore = {
    latest: async () => saved,
    save: async () => saved,
  }
  const inputs: unknown[] = []
  const places: PlacesService = {
    nearby: async (input) => {
      inputs.push(input)
      return []
    },
  }
  const ui = new UIEventChannel()
  const sessionId = crypto.randomUUID()
  const cards: unknown[] = []
  ui.subscribe(
    sessionId,
    (event) => cards.push(event),
    () => {},
  )

  for (const [category, searchQuery] of [
    ['hotel', null],
    ['park', null],
    ['other', 'museums'],
  ] as const) {
    await executeLocationTool(
      location,
      places,
      ui,
      sessionId,
      'find_nearby_places',
      JSON.stringify({
        category,
        search_query: searchQuery,
        radius_meters: 15000,
        travel_mode: 'DRIVE',
        note: `A few ${category} options farther out.`,
      }),
    )
  }

  expect(inputs).toHaveLength(3)
  expect(inputs[0]).toHaveProperty('radiusMeters', 15000)
  expect(cards).toHaveLength(3)
  expect(cards[2]).toHaveProperty('card.category', 'other')
  expect(cards[2]).toHaveProperty('card.query', 'museums')
})

test('closing a channel session ends subscribers', async () => {
  const channel = new UIEventChannel()
  const sessionId = crypto.randomUUID()
  let closed = 0
  channel.subscribe(
    sessionId,
    () => {},
    () => {
      closed += 1
    },
  )

  channel.closeSession(sessionId)

  expect(closed).toBe(1)
  channel.closeSession(sessionId)
  expect(closed).toBe(1)
})

test('late UI subscribers receive only the latest options', async () => {
  const channel = new UIEventChannel()
  const sessionId = crypto.randomUUID()
  channel.emit(sessionId, {
    type: 'reservation-options',
    kind: 'hotels',
    options: { message: 'First' },
  })
  channel.emit(sessionId, {
    type: 'reservation-options',
    kind: 'hotels',
    options: { message: 'Latest' },
  })
  const events: unknown[] = []
  channel.subscribe(
    sessionId,
    (event) => events.push(event),
    () => {},
  )

  expect(events).toEqual([
    {
      type: 'reservation-options',
      kind: 'hotels',
      options: { message: 'Latest' },
    },
  ])
  channel.closeSession(sessionId)
  const afterClose: unknown[] = []
  channel.subscribe(
    sessionId,
    (event) => afterClose.push(event),
    () => {},
  )
  expect(afterClose).toEqual([])
})
