import { z } from '@hono/zod-openapi'

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi('ApiError')

export const authResponseSchema = z
  .object({
    accessToken: z.string(),
    expiresAt: z.string().datetime(),
  })
  .openapi('AuthResponse')

export const voiceAnswerSchema = z
  .object({ id: z.string().uuid(), sdp: z.string() })
  .openapi('VoiceAnswer')
export const voiceStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
    error: z.string().nullable(),
    finalization: z.string().nullable(),
  })
  .openapi('VoiceStatus')
export const placeCategorySchema = z.enum([
  'cafe',
  'restaurant',
  'hotel',
  'park',
  'other',
])
export const placeCardSchema = z.object({
  id: z.string().uuid(),
  note: z.string(),
  category: placeCategorySchema,
  query: z.string(),
  travelMode: z.enum(['WALK', 'DRIVE']),
  places: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      url: z.string().url(),
      distanceMeters: z.number().nullable(),
      durationSeconds: z.number().nullable(),
    }),
  ),
})
export const voiceUiEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('place-card'), card: placeCardSchema }),
  z.object({
    type: z.literal('reservation-state'),
    reservation: z.lazy(() => reservationStateSchema),
  }),
  z.object({
    type: z.literal('reservation-options'),
    kind: z.enum(['hotels', 'rooms', 'dates', 'reservations']),
    options: z.lazy(() =>
      z.union([
        z.array(hotelOptionSchema),
        z.array(offeringOptionSchema),
        z.array(dateOptionSchema),
        z.array(reservationStateSchema),
        z.object({ message: z.string() }),
      ]),
    ),
  }),
])

export const reservationStateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'abandoned', 'confirmed']),
  hotelId: z.string().uuid().nullable(),
  hotel: z.string().nullable(),
  city: z.string().nullable(),
  brand: z.string().nullable(),
  stayDate: z.string().nullable(),
  guestName: z.string().nullable(),
  rooms: z.array(
    z.object({
      offeringId: z.string().uuid(),
      name: z.string(),
      quantity: z.number(),
      unitPriceSar: z.number(),
      lineTotalSar: z.number(),
    }),
  ),
  quotedTotalSar: z.number().nullable(),
  confirmedTotalSar: z.number().nullable(),
  nextMissingField: z
    .enum(['hotel', 'stayDate', 'rooms', 'guestName'])
    .nullable(),
  reason: z.string().nullable(),
  revision: z.number(),
  updatedAt: z.string(),
})
export const hotelOptionSchema = z.object({
  id: z.string().uuid(),
  brandName: z.string(),
  locationName: z.string(),
  city: z.string(),
})
export const offeringOptionSchema = z.object({
  id: z.string().uuid(),
  hotelId: z.string().uuid(),
  name: z.string(),
  priceSar: z.number(),
  available: z.number(),
})
export const dateOptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  availableRooms: z.number().int().nonnegative(),
})
