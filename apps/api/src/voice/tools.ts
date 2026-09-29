import { placeCategorySchema } from '@voice/contracts'
import type { LocationService, MemoryService } from '@voice/database'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { z } from 'zod'
import type { PlacesService } from './places.js'
import type { UIEventChannel } from './ui-event-channel.js'

const nullableLabel = z.string().trim().min(1).max(128).nullable()
const nullableTime = z.string().datetime({ offset: true }).nullable()
const fact = z
  .object({
    content: z.string().trim().min(1).max(2000),
    entity: nullableLabel,
    event_at: nullableTime,
  })
  .strict()
const search = z
  .object({
    query: z.string().max(256).nullable(),
    entity: nullableLabel,
    from: nullableTime,
    to: nullableTime,
    limit: z.number().int().min(1).max(20),
  })
  .strict()
  .refine(
    (value) =>
      !value.from ||
      !value.to ||
      Date.parse(value.from) <= Date.parse(value.to),
    'Invalid time range',
  )
const correction = fact.extend({ memory_id: z.string().uuid() })
const label = { type: ['string', 'null'], maxLength: 128 }
const time = { type: ['string', 'null'], format: 'date-time' }
const factProperties = {
  content: { type: 'string', maxLength: 2000 },
  entity: label,
  event_at: time,
}
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
): FunctionTool => ({
  type: 'function',
  name,
  description,
  strict: true,
  parameters: {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  },
})

export const memoryTools: FunctionTool[] = [
  tool(
    'search_memory',
    'Search shared saved facts using literal keywords, an exact entity label, and optional event-time bounds. Returns IDs for correction.',
    {
      query: { type: ['string', 'null'], maxLength: 256 },
      entity: label,
      from: time,
      to: time,
      limit: { type: 'integer', minimum: 1, maximum: 20 },
    },
  ),

  tool(
    'remember_fact',
    'Save one useful fact or preference stated by the user, even without a request to remember it. Search first to avoid duplicate facts. Use null for unknown metadata.',
    factProperties,
  ),

  tool(
    'correct_memory',
    'Replace a saved fact in place using its memory ID. Preserve known metadata unless the user changes it.',
    {
      memory_id: { type: 'string', format: 'uuid' },
      ...factProperties,
    },
  ),
]

export const locationTools: FunctionTool[] = [
  tool(
    'get_user_location',
    'Get the user’s latest saved location. If there is none, ask the browser to show its location switch and wait for the user’s grant or denial before returning. Call this when location is needed for a request.',
    {},
  ),
  tool(
    'find_nearby_places',
    'Find coffee shops, restaurants, hotels, parks, or another requested place type using the most recently saved location. Call get_user_location first when location has not been confirmed for the request. Set search_query to null for broad named categories; provide a specific search_query for other types or a specific request such as Italian restaurants. Increase radius_meters when the user asks for places farther away, up to 50000. The note is a short personal sentence shown above the place list; base it on the user’s request without inventing place facts.',
    {
      category: { type: 'string', enum: placeCategorySchema.options },
      search_query: { type: ['string', 'null'], maxLength: 100 },
      radius_meters: { type: 'integer', minimum: 100, maximum: 50000 },
      travel_mode: { type: 'string', enum: ['WALK', 'DRIVE'] },
      note: { type: 'string', maxLength: 180 },
    },
  ),
]

const nearbyArguments = z
  .object({
    category: placeCategorySchema,
    search_query: z.string().trim().min(1).max(100).nullable(),
    radius_meters: z.number().int().min(100).max(50000),
    travel_mode: z.enum(['WALK', 'DRIVE']),
    note: z.string().trim().min(1).max(180),
  })
  .strict()
  .refine(
    (value) => value.category !== 'other' || value.search_query !== null,
    'A search query is required for other places',
  )

export async function executeLocationTool(
  location: LocationService,
  places: PlacesService,
  ui: UIEventChannel,
  sessionId: string,
  name: string,
  argumentsJson: string,
) {
  if (argumentsJson.length > 8192) {
    throw new Error('Tool arguments are too large')
  }

  const parsed: unknown = JSON.parse(argumentsJson)

  if (name === 'get_user_location') {
    z.object({}).strict().parse(parsed)
    const saved = await location.latest()

    if (saved) {
      return {
        status: 'granted',
        location: {
          latitude: saved.latitude,
          longitude: saved.longitude,
          accuracyMeters: saved.accuracyMeters,
        },
      }
    }

    const reply = await ui.requestLocation(sessionId)

    if (reply.status === 'denied') {
      return {
        status: 'denied',
        message: 'The user did not enable location access.',
      }
    }

    return {
      status: 'granted',
      location: {
        latitude: reply.latitude,
        longitude: reply.longitude,
        accuracyMeters: reply.accuracyMeters,
      },
    }
  }

  if (name !== 'find_nearby_places') {
    throw new Error('Unknown location tool')
  }

  const args = nearbyArguments.parse(parsed)
  const current = await location.latest()

  if (!current) {
    return {
      locationUnavailable: true,
      message:
        'No location is saved yet. Ask the user to select Enable location in the app, then retry the search.',
    }
  }

  const results = await places.nearby({
    category: args.category,
    searchQuery: args.search_query,
    radiusMeters: args.radius_meters,
    travelMode: args.travel_mode,
    location: current,
  })
  ui.emit(sessionId, {
    type: 'place-card',
    card: {
      id: crypto.randomUUID(),
      note: args.note,
      category: args.category,
      query: args.search_query ?? '',
      travelMode: args.travel_mode,
      places: results,
    },
  })
  return { places: results, travelMode: args.travel_mode }
}
export async function executeMemoryTool(
  memory: MemoryService,
  sessionId: string,
  name: string,
  argumentsJson: string,
) {
  if (argumentsJson.length > 8192) {
    throw new Error('Tool arguments are too large')
  }
  const args: unknown = JSON.parse(argumentsJson)
  switch (name) {
    case 'search_memory':
      return { memories: await memory.search(search.parse(args)) }
    case 'remember_fact':
      return { memory: await memory.remember(sessionId, fact.parse(args)) }
    case 'correct_memory': {
      const { memory_id, ...input } = correction.parse(args)
      return { memory: await memory.correct(memory_id, input) }
    }
    default:
      throw new Error('Unknown memory tool')
  }
}
