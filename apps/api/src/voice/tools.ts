import { placeCategorySchema } from '@voice/contracts'
import {
  cityMatchesQuery,
  type LocationService,
  type MemoryService,
  type ReservationService,
  type ReservationState,
  todayInBookingTimezone,
  weekdayForStayDate,
} from '@voice/database'
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

export const reservationTools: FunctionTool[] = [
  tool(
    'get_active_reservation',
    'Read the current draft and its revision before editing. Read-only.',
    {},
  ),
  tool(
    'start_reservation',
    'Start a new hotel reservation draft. This abandons an existing unfinished draft. Save optional known details in the new draft.',
    {
      hotel_name: label,
      stay_date: { type: ['string', 'null'] },
      guest_name: label,
      rooms: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantity: { type: 'integer' },
          },
          required: ['name', 'quantity'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool(
    'update_reservation',
    'Save hotel, exact stay date, guest name, or room selections in any order. Supply the last seen revision. Null means leave a field unchanged. Room selections replace the entire room list.',
    {
      reservation_id: { type: 'string', format: 'uuid' },
      revision: { type: 'integer' },
      hotel_name: label,
      stay_date: { type: ['string', 'null'] },
      guest_name: label,
      rooms: {
        type: ['array', 'null'],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantity: { type: 'integer' },
          },
          required: ['name', 'quantity'],
          additionalProperties: false,
        },
      },
    },
  ),
  tool(
    'reservation_options',
    'Show hotels filtered by city and, when a date is given, room availability; show seven date options or room types without editing a reservation. Use the requested city, including partial names such as Khobar for Al Khobar, or null for all cities.',
    {
      field: { type: 'string', enum: ['hotel', 'rooms', 'date'] },
      city: label,
      hotel_name: label,
      stay_date: { type: ['string', 'null'] },
    },
  ),
  tool(
    'find_reservations',
    'Search the shared reservation history. Filters combine; upcoming means confirmed stays today or later. Searches never edit a draft.',
    {
      upcoming: { type: 'boolean' },
      city: label,
      brand: label,
      status: {
        type: ['string', 'null'],
        enum: ['confirmed', 'abandoned', 'draft', null],
      },
    },
  ),
  tool(
    'reservation_action',
    'Abandon, resume, or confirm a selected draft. Confirm only after the customer explicitly agrees to the reviewed hotel, date, rooms, and total. Supply its last seen revision. A changed quote remains a draft and requires fresh approval.',
    {
      action: { type: 'string', enum: ['abandon', 'resume', 'confirm'] },
      reservation_id: { type: 'string', format: 'uuid' },
      revision: { type: 'integer' },
    },
  ),
]

const startReservationArgs = z
  .object({
    hotel_name: nullableLabel,
    stay_date: z.string().nullable(),
    guest_name: nullableLabel,
    rooms: z
      .array(
        z
          .object({
            name: z.string().trim().min(1),
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .nullable(),
  })
  .strict()
const updateReservationArgs = startReservationArgs
  .extend({
    reservation_id: z.string().uuid(),
    revision: z.number().int().positive(),
  })
  .strict()
const optionsArgs = z
  .object({
    field: z.enum(['hotel', 'rooms', 'date']),
    city: nullableLabel,
    hotel_name: nullableLabel,
    stay_date: z.string().nullable(),
  })
  .strict()
const findArgs = z
  .object({
    upcoming: z.boolean(),
    city: nullableLabel,
    brand: nullableLabel,
    status: z.enum(['confirmed', 'abandoned', 'draft']).nullable(),
  })
  .strict()
const actionArgs = z
  .object({
    action: z.enum(['abandon', 'resume', 'confirm']),
    reservation_id: z.string().uuid(),
    revision: z.number().int().positive(),
  })
  .strict()

export async function executeReservationTool(
  service: ReservationService,
  ui: UIEventChannel,
  sessionId: string,
  name: string,
  argumentsJson: string,
) {
  if (argumentsJson.length > 8192) {
    throw new Error('Tool arguments are too large')
  }

  const parsed: unknown = JSON.parse(argumentsJson)
  const catalog = await service.hotels()
  const resolveHotel = (name: string | null, choices = catalog) => {
    if (!name) {
      return null
    }

    const matching = choices.filter(
      (hotel) =>
        hotel.locationName.toLowerCase() === name.toLowerCase() ||
        hotel.brandName.toLowerCase() === name.toLowerCase(),
    )

    if (matching.length === 0) {
      const cityMatches = choices.filter((hotel) =>
        cityMatchesQuery(hotel.city, name),
      )

      if (cityMatches.length > 0) {
        return cityMatches
      }
    }

    return matching.length === 1 ? matching[0] : matching
  }
  const publish = (state: ReservationState) => {
    ui.emit(sessionId, { type: 'reservation-state', reservation: state })
    return { reservation: state }
  }

  if (name === 'get_active_reservation') {
    z.object({}).strict().parse(parsed)
    const reservation = await service.active()

    if (reservation) {
      ui.emit(sessionId, { type: 'reservation-state', reservation })
    }

    return { reservation }
  }

  if (name === 'reservation_options') {
    const args = optionsArgs.parse(parsed)
    const cityQuery = args.city
    const cityCatalog = cityQuery
      ? catalog.filter((candidate) =>
          cityMatchesQuery(candidate.city, cityQuery),
        )
      : catalog
    const hotel = resolveHotel(args.hotel_name, cityCatalog)

    if (args.field === 'hotel') {
      const hotelName = args.hotel_name
      const matching = hotelName
        ? cityCatalog.filter(
            (candidate) =>
              candidate.locationName.toLowerCase() ===
                hotelName.toLowerCase() ||
              candidate.brandName.toLowerCase() === hotelName.toLowerCase() ||
              cityMatchesQuery(candidate.city, hotelName),
          )
        : cityCatalog
      const stayDate = args.stay_date
      let options = matching

      if (stayDate) {
        weekdayForStayDate(stayDate)
        const availability = await Promise.all(
          matching.map(async (candidate) => ({
            candidate,
            rooms: await service.offerings(candidate.id, stayDate),
          })),
        )
        options = availability
          .filter(({ rooms }) => rooms.some((room) => room.available > 0))
          .map(({ candidate }) => candidate)
      }

      ui.emit(sessionId, {
        type: 'reservation-options',
        kind: 'hotels',
        options,
      })
      return { options }
    }

    if (args.field === 'date' && hotel && !Array.isArray(hotel)) {
      const first = args.stay_date ?? todayInBookingTimezone()
      weekdayForStayDate(first)
      const base = new Date(`${first}T12:00:00Z`)
      const options = await Promise.all(
        Array.from({ length: 7 }, async (_, offset) => {
          const date = new Date(base.getTime() + offset * 86_400_000)
            .toISOString()
            .slice(0, 10)
          const rooms = await service.offerings(hotel.id, date)
          return {
            date,
            availableRooms: rooms.reduce(
              (sum, room) => sum + room.available,
              0,
            ),
          }
        }),
      )
      ui.emit(sessionId, {
        type: 'reservation-options',
        kind: 'dates',
        options,
      })
      return { options }
    }

    const kind =
      !args.hotel_name || !hotel || Array.isArray(hotel) ? 'hotels' : 'rooms'
    const options =
      !args.hotel_name || !hotel
        ? cityCatalog
        : Array.isArray(hotel)
          ? hotel.length
            ? hotel
            : cityCatalog
          : args.stay_date
            ? await service.offerings(hotel.id, args.stay_date)
            : { message: 'Choose an exact stay date to see availability' }
    ui.emit(sessionId, { type: 'reservation-options', kind, options })
    return { options }
  }

  if (name === 'find_reservations') {
    const args = findArgs.parse(parsed)
    const results = await service.list({
      upcoming: args.upcoming,
      city: args.city ?? undefined,
      brand: args.brand ?? undefined,
      status: args.status ?? undefined,
    })
    ui.emit(sessionId, {
      type: 'reservation-options',
      kind: 'reservations',
      options: results,
    })
    return { reservations: results }
  }

  if (name === 'reservation_action') {
    const args = actionArgs.parse(parsed)
    return publish(
      await service[args.action](args.reservation_id, args.revision),
    )
  }

  if (name === 'start_reservation' || name === 'update_reservation') {
    const args =
      name === 'start_reservation'
        ? startReservationArgs.parse(parsed)
        : updateReservationArgs.parse(parsed)
    const hotel = resolveHotel(args.hotel_name)

    if (Array.isArray(hotel)) {
      const choices = hotel.length ? hotel : catalog
      ui.emit(sessionId, {
        type: 'reservation-options',
        kind: 'hotels',
        options: choices,
      })

      if (name === 'start_reservation') {
        const reservation = await service.create({
          ...(args.stay_date ? { stayDate: args.stay_date } : {}),
          ...(args.guest_name ? { guestName: args.guest_name } : {}),
        })
        return {
          ...publish(reservation),
          choices,
          message: 'Choose one hotel location',
        }
      }

      return { choices, message: 'Choose one hotel location' }
    }

    const patch: {
      hotelId?: string
      stayDate?: string
      guestName?: string
      rooms?: { offeringId: string; quantity: number }[]
    } = {}

    if (hotel) {
      patch.hotelId = hotel.id
    }

    if (args.stay_date) {
      patch.stayDate = args.stay_date
    }

    if (args.guest_name) {
      patch.guestName = args.guest_name
    }

    if (args.rooms) {
      const update =
        name === 'update_reservation'
          ? (args as z.infer<typeof updateReservationArgs>)
          : null
      const current = update ? await service.get(update.reservation_id) : null
      const hotelId = patch.hotelId ?? current?.hotelId
      const date = patch.stayDate ?? current?.stayDate

      if (!hotelId || !date) {
        if (name === 'start_reservation') {
          return {
            ...publish(await service.create(patch)),
            message: 'Choose a hotel and date before rooms',
          }
        }

        return { message: 'Choose a hotel and date before rooms' }
      }

      const offerings = await service.offerings(hotelId, date)
      const selections: { offeringId: string; quantity: number }[] = []

      for (const room of args.rooms) {
        const matching = offerings.filter(
          (offering) => offering.name.toLowerCase() === room.name.toLowerCase(),
        )

        if (matching.length !== 1) {
          ui.emit(sessionId, {
            type: 'reservation-options',
            kind: 'rooms',
            options: offerings,
          })

          if (name === 'start_reservation') {
            return {
              ...publish(await service.create(patch)),
              choices: offerings,
              message: 'Choose a listed room type',
            }
          }

          return { choices: offerings, message: 'Choose a listed room type' }
        }

        const selected = matching[0]

        if (selected) {
          selections.push({ offeringId: selected.id, quantity: room.quantity })
        }
      }

      patch.rooms = selections
    }

    if (name === 'update_reservation') {
      const update = args as z.infer<typeof updateReservationArgs>

      return publish(
        await service.update(update.reservation_id, {
          revision: update.revision,
          ...patch,
        }),
      )
    }

    return publish(await service.create(patch))
  }

  throw new Error('Unknown reservation tool')
}

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
