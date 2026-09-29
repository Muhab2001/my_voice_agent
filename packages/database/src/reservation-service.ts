import { and, desc, eq } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import {
  hotelOfferings,
  hotels,
  reservations,
  type StoredRoom,
} from './schema.js'

export type ReservationPatch = {
  revision: number
  hotelId?: string | null
  stayDate?: string | null
  guestName?: string | null
  rooms?: { offeringId: string; quantity: number }[]
}
export type ReservationFilter = {
  upcoming?: boolean
  city?: string
  brand?: string
  status?: 'draft' | 'abandoned' | 'confirmed'
}
export type ReservationState = {
  id: string
  status: 'draft' | 'abandoned' | 'confirmed'
  hotelId: string | null
  hotel: string | null
  city: string | null
  brand: string | null
  stayDate: string | null
  guestName: string | null
  rooms: (StoredRoom & { lineTotalSar: number })[]
  quotedTotalSar: number | null
  confirmedTotalSar: number | null
  nextMissingField: 'hotel' | 'stayDate' | 'rooms' | 'guestName' | null
  reason: string | null
  revision: number
  updatedAt: string
}
export type HotelOption = {
  id: string
  brandName: string
  locationName: string
  city: string
}
export type OfferingOption = {
  id: string
  hotelId: string
  name: string
  priceSar: number
  available: number
}

export class ReservationError extends Error {
  constructor(
    public readonly code: 'not_found' | 'invalid' | 'conflict',
    message: string,
    public readonly latest?: ReservationState,
  ) {
    super(message)
  }
}

export const BOOKING_TIME_ZONE = 'Asia/Riyadh'

export function cityMatchesQuery(city: string, query: string): boolean {
  const normalizedCity = city.trim().replace(/\s+/g, ' ').toLowerCase()
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase()

  return normalizedQuery.length > 0 && normalizedCity.includes(normalizedQuery)
}

export function todayInBookingTimezone(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function weekdayForStayDate(date: string): number {
  const parsed = new Date(`${date}T12:00:00Z`)

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    todayInBookingTimezone(parsed) !== date
  ) {
    throw new ReservationError('invalid', 'Choose a valid calendar date')
  }

  return parsed.getUTCDay()
}

/** One authoritative service for browser and agent reservation changes. */
export interface ReservationService {
  hotels(): Promise<HotelOption[]>
  offerings(hotelId: string, date: string): Promise<OfferingOption[]>
  create(patch?: Omit<ReservationPatch, 'revision'>): Promise<ReservationState>
  get(id: string): Promise<ReservationState | null>
  active(): Promise<ReservationState | null>
  list(filter: ReservationFilter): Promise<ReservationState[]>
  update(id: string, patch: ReservationPatch): Promise<ReservationState>
  confirm(id: string, revision: number): Promise<ReservationState>
  abandon(id: string, revision: number): Promise<ReservationState>
  resume(id: string, revision: number): Promise<ReservationState>
}

export class DrizzleReservationService implements ReservationService {
  constructor(private readonly client: DrizzleClient) {}

  async hotels(): Promise<HotelOption[]> {
    return this.client
      .select({
        id: hotels.id,
        brandName: hotels.brandName,
        locationName: hotels.locationName,
        city: hotels.city,
      })
      .from(hotels)
      .where(eq(hotels.active, 1))
  }

  async offerings(hotelId: string, date: string): Promise<OfferingOption[]> {
    const day = weekdayForStayDate(date)
    const hotel = await this.client
      .select({ id: hotels.id })
      .from(hotels)
      .where(and(eq(hotels.id, hotelId), eq(hotels.active, 1)))
      .limit(1)

    if (!hotel.length) {
      throw new ReservationError('not_found', 'Hotel not found')
    }

    const rows = await this.client
      .select()
      .from(hotelOfferings)
      .where(
        and(eq(hotelOfferings.hotelId, hotelId), eq(hotelOfferings.active, 1)),
      )
    return rows.map((row) => ({
      id: row.id,
      hotelId: row.hotelId,
      name: row.name,
      priceSar: row.priceSar,
      available: row.weeklyAvailability[day] ?? 0,
    }))
  }

  private async snapshot(
    row: typeof reservations.$inferSelect,
    reason: string | null = null,
  ): Promise<ReservationState> {
    const [hotel] = row.hotelId
      ? await this.client
          .select()
          .from(hotels)
          .where(eq(hotels.id, row.hotelId))
          .limit(1)
      : []
    const rooms = row.rooms.map((room) => ({
      ...room,
      lineTotalSar: room.quantity * room.unitPriceSar,
    }))
    return {
      id: row.id,
      status: row.status,
      hotelId: row.hotelId,
      hotel: hotel?.locationName ?? null,
      city: hotel?.city ?? null,
      brand: hotel?.brandName ?? null,
      stayDate: row.stayDate,
      guestName: row.guestName,
      rooms,
      quotedTotalSar: row.quotedTotalSar,
      confirmedTotalSar: row.confirmedTotalSar,
      nextMissingField: !row.hotelId
        ? 'hotel'
        : !row.stayDate
          ? 'stayDate'
          : !rooms.length
            ? 'rooms'
            : !row.guestName
              ? 'guestName'
              : null,
      reason,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async get(id: string): Promise<ReservationState | null> {
    const [row] = await this.client
      .select()
      .from(reservations)
      .where(eq(reservations.id, id))
      .limit(1)
    return row ? this.snapshot(row) : null
  }

  async active(): Promise<ReservationState | null> {
    const [draft] = await this.client
      .select()
      .from(reservations)
      .where(eq(reservations.status, 'draft'))
      .limit(1)

    if (draft) {
      return this.snapshot(draft)
    }

    const [row] = await this.client
      .select()
      .from(reservations)
      .orderBy(desc(reservations.updatedAt))
      .limit(1)
    return row ? this.snapshot(row) : null
  }

  async list(filter: ReservationFilter): Promise<ReservationState[]> {
    if (filter.upcoming && filter.status && filter.status !== 'confirmed') {
      return []
    }

    const status = filter.status ?? 'confirmed'
    const rows = await this.client
      .select()
      .from(reservations)
      .where(eq(reservations.status, status))
      .orderBy(desc(reservations.updatedAt))
    const states = await Promise.all(rows.map((row) => this.snapshot(row)))
    const matching = states.filter(
      (state) =>
        (!filter.upcoming ||
          (state.stayDate !== null &&
            state.stayDate >= todayInBookingTimezone())) &&
        (!filter.city ||
          (state.city !== null && cityMatchesQuery(state.city, filter.city))) &&
        (!filter.brand ||
          state.brand?.toLowerCase() === filter.brand.toLowerCase()),
    )
    return filter.upcoming
      ? matching.sort((a, b) =>
          (a.stayDate ?? '').localeCompare(b.stayDate ?? ''),
        )
      : matching
  }

  async create(
    patch: Omit<ReservationPatch, 'revision'> = {},
  ): Promise<ReservationState> {
    const hotelId = patch.hotelId ?? null
    const stayDate = patch.stayDate ?? null
    const guestName = patch.guestName ?? null

    if (hotelId) {
      const [hotel] = await this.client
        .select()
        .from(hotels)
        .where(and(eq(hotels.id, hotelId), eq(hotels.active, 1)))
        .limit(1)

      if (!hotel) {
        throw new ReservationError('invalid', 'Unknown hotel')
      }
    }

    if (stayDate) {
      weekdayForStayDate(stayDate)
    }

    let rooms: StoredRoom[] = []
    let reason: string | null = null

    if (patch.rooms?.length) {
      if (!hotelId || !stayDate) {
        throw new ReservationError(
          'invalid',
          'Select a hotel and date before rooms',
        )
      }

      const offerings = await this.offerings(hotelId, stayDate)
      const seen = new Set<string>()

      for (const selection of patch.rooms) {
        const offering = offerings.find(
          (item) => item.id === selection.offeringId,
        )

        if (
          !offering ||
          seen.has(selection.offeringId) ||
          !Number.isInteger(selection.quantity) ||
          selection.quantity < 1
        ) {
          throw new ReservationError('invalid', 'Invalid room selection')
        }

        seen.add(selection.offeringId)

        if (selection.quantity > offering.available) {
          reason = `${offering.name} has insufficient availability on this date`
        } else {
          rooms.push({
            offeringId: offering.id,
            name: offering.name,
            quantity: selection.quantity,
            unitPriceSar: offering.priceSar,
          })
        }
      }

      if (reason) {
        rooms = []
      }
    }

    const id = await this.client.transaction(async (tx) => {
      const drafts = await tx
        .select()
        .from(reservations)
        .where(eq(reservations.status, 'draft'))
        .for('update')

      for (const draft of drafts) {
        await tx
          .update(reservations)
          .set({
            status: 'abandoned',
            revision: draft.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(reservations.id, draft.id))
      }

      const [row] = await tx
        .insert(reservations)
        .values({
          hotelId,
          stayDate,
          guestName,
          rooms,
          quotedTotalSar: rooms.length
            ? rooms.reduce(
                (sum, room) => sum + room.quantity * room.unitPriceSar,
                0,
              )
            : null,
        })
        .returning({ id: reservations.id })
      return row?.id
    })

    if (!id) {
      throw new Error('Reservation create failed')
    }

    const state = await this.get(id)

    if (!state) {
      throw new Error('Reservation create failed')
    }

    return { ...state, reason }
  }

  async update(id: string, patch: ReservationPatch): Promise<ReservationState> {
    const row = await this.client.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reservations)
        .where(eq(reservations.id, id))
        .for('update')

      if (!current) {
        throw new ReservationError('not_found', 'Reservation not found')
      }

      if (current.revision !== patch.revision) {
        throw new ReservationError(
          'conflict',
          'Reservation changed; review the latest state',
        )
      }

      if (current.status !== 'draft') {
        throw new ReservationError('invalid', 'Only drafts can be edited')
      }

      const hotelId =
        patch.hotelId === undefined ? current.hotelId : patch.hotelId
      const stayDate =
        patch.stayDate === undefined ? current.stayDate : patch.stayDate
      const guestName =
        patch.guestName === undefined ? current.guestName : patch.guestName
      const changedStay =
        hotelId !== current.hotelId || stayDate !== current.stayDate

      if (hotelId) {
        const [hotel] = await tx
          .select()
          .from(hotels)
          .where(and(eq(hotels.id, hotelId), eq(hotels.active, 1)))

        if (!hotel) {
          throw new ReservationError('invalid', 'Unknown hotel')
        }
      }

      if (stayDate) {
        weekdayForStayDate(stayDate)
      }

      let rooms = changedStay ? [] : current.rooms
      let reason: string | null = null

      if (patch.rooms !== undefined) {
        if (!hotelId || !stayDate) {
          throw new ReservationError(
            'invalid',
            'Select a hotel and date before rooms',
          )
        }

        const day = weekdayForStayDate(stayDate)
        const offered = await tx
          .select()
          .from(hotelOfferings)
          .where(
            and(
              eq(hotelOfferings.hotelId, hotelId),
              eq(hotelOfferings.active, 1),
            ),
          )
        const selected = new Set<string>()
        const nextRooms: StoredRoom[] = []

        for (const selection of patch.rooms) {
          const offering = offered.find(
            (item) => item.id === selection.offeringId,
          )

          if (
            !offering ||
            selected.has(selection.offeringId) ||
            !Number.isInteger(selection.quantity) ||
            selection.quantity < 1
          ) {
            throw new ReservationError('invalid', 'Invalid room selection')
          }

          selected.add(selection.offeringId)

          if (selection.quantity > (offering.weeklyAvailability[day] ?? 0)) {
            reason = `${offering.name} has insufficient availability on this date`
            continue
          }

          nextRooms.push({
            offeringId: offering.id,
            name: offering.name,
            quantity: selection.quantity,
            unitPriceSar: offering.priceSar,
          })
        }

        rooms = reason ? [] : nextRooms
      }

      const [updated] = await tx
        .update(reservations)
        .set({
          hotelId,
          stayDate,
          guestName,
          rooms,
          quotedTotalSar: rooms.length
            ? rooms.reduce(
                (sum, room) => sum + room.quantity * room.unitPriceSar,
                0,
              )
            : null,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id))
        .returning()
      return { updated, reason }
    })
    return this.snapshot(
      row.updated as typeof reservations.$inferSelect,
      row.reason,
    )
  }

  async confirm(id: string, revision: number): Promise<ReservationState> {
    const result = await this.client.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reservations)
        .where(eq(reservations.id, id))
        .for('update')

      if (!current) {
        throw new ReservationError('not_found', 'Reservation not found')
      }

      if (current.revision !== revision) {
        throw new ReservationError(
          'conflict',
          'Reservation changed; review the latest state',
        )
      }

      if (
        current.status !== 'draft' ||
        !current.hotelId ||
        !current.stayDate ||
        current.stayDate < todayInBookingTimezone() ||
        !current.guestName ||
        !current.rooms.length ||
        current.quotedTotalSar === null
      ) {
        throw new ReservationError(
          'invalid',
          'Complete the reservation with a future date before confirming',
        )
      }

      const day = weekdayForStayDate(current.stayDate)
      const offered = await tx
        .select()
        .from(hotelOfferings)
        .where(
          and(
            eq(hotelOfferings.hotelId, current.hotelId),
            eq(hotelOfferings.active, 1),
          ),
        )
      const valid = current.rooms.every((room) => {
        const offering = offered.find((item) => item.id === room.offeringId)
        return offering && offering.weeklyAvailability[day] >= room.quantity
      })
      const rooms = valid
        ? current.rooms.map((room) => ({
            ...room,
            unitPriceSar:
              offered.find((item) => item.id === room.offeringId)?.priceSar ??
              room.unitPriceSar,
          }))
        : []
      const total = rooms.reduce(
        (sum, room) => sum + room.quantity * room.unitPriceSar,
        0,
      )
      const changed = !valid || total !== current.quotedTotalSar
      const [updated] = await tx
        .update(reservations)
        .set(
          changed
            ? {
                rooms,
                quotedTotalSar: rooms.length ? total : null,
                revision: current.revision + 1,
                updatedAt: new Date(),
              }
            : {
                status: 'confirmed',
                confirmedTotalSar: total,
                revision: current.revision + 1,
                updatedAt: new Date(),
              },
        )
        .where(eq(reservations.id, id))
        .returning()
      return {
        updated,
        reason: changed
          ? 'Availability or price changed. Review the updated quote and confirm again.'
          : null,
      }
    })
    return this.snapshot(
      result.updated as typeof reservations.$inferSelect,
      result.reason,
    )
  }

  private async changeStatus(
    id: string,
    revision: number,
    from: 'draft' | 'abandoned',
    to: 'draft' | 'abandoned',
  ): Promise<ReservationState> {
    const row = await this.client.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(reservations)
        .where(eq(reservations.id, id))
        .for('update')

      if (!current) {
        throw new ReservationError('not_found', 'Reservation not found')
      }

      if (current.revision !== revision) {
        throw new ReservationError(
          'conflict',
          'Reservation changed; review the latest state',
        )
      }

      if (current.status !== from) {
        throw new ReservationError(
          'invalid',
          `Only ${from} reservations can be ${to}`,
        )
      }

      if (to === 'draft') {
        const drafts = await tx
          .select()
          .from(reservations)
          .where(eq(reservations.status, 'draft'))
          .for('update')

        for (const draft of drafts) {
          await tx
            .update(reservations)
            .set({
              status: 'abandoned',
              revision: draft.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(reservations.id, draft.id))
        }
      }

      const [updated] = await tx
        .update(reservations)
        .set({
          status: to,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(reservations.id, id))
        .returning()
      return updated
    })
    return this.snapshot(row as typeof reservations.$inferSelect)
  }

  abandon(id: string, revision: number): Promise<ReservationState> {
    return this.changeStatus(id, revision, 'draft', 'abandoned')
  }

  resume(id: string, revision: number): Promise<ReservationState> {
    return this.changeStatus(id, revision, 'abandoned', 'draft')
  }
}
