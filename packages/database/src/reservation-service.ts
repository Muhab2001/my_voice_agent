import type { StoredRoom } from './schema.js'

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
export interface ReservationStore {
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
