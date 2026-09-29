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

export const loginSchema = z
  .object({
    password: z.string().min(1).max(1024),
  })
  .openapi('LoginRequest')

export const healthSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']),
  })
  .openapi('HealthResponse')

export const readinessSchema = z
  .object({
    status: z.enum(['ok', 'unavailable']),
    resources: z.record(z.string()),
  })
  .openapi('ReadinessResponse')

export const voiceOfferSchema = z
  .object({ sdp: z.string().min(1).max(100_000) })
  .openapi('VoiceOffer')
export const voiceAnswerSchema = z
  .object({ id: z.string().uuid(), sdp: z.string() })
  .openapi('VoiceAnswer')
export const voiceIdSchema = z.object({ id: z.string().uuid() })
export const voiceStatusSchema = z
  .object({
    id: z.string().uuid(),
    status: z.string(),
    error: z.string().nullable(),
    finalization: z.string().nullable(),
  })
  .openapi('VoiceStatus')
export const transcriptSnapshotSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  startMs: z.number().int(),
  endMs: z.number().int(),
  createdAt: z.string().datetime(),
})
export const transcriptResponseSchema = z
  .object({ snapshots: z.array(transcriptSnapshotSchema) })
  .openapi('Transcripts')

export const locationInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(100_000),
})
export const locationToolReplySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('granted'), ...locationInputSchema.shape }),
  z.object({ status: z.literal('denied') }),
])
export const locationToolReplyParamsSchema = voiceIdSchema.extend({
  requestId: z.string().uuid(),
})
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
  z.object({
    type: z.literal('location-request'),
    requestId: z.string().uuid(),
  }),
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

export const reservationRoomInputSchema = z
  .object({
    offeringId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
  })
  .strict()
export const reservationPatchSchema = z
  .object({
    revision: z.number().int().positive(),
    hotelId: z.string().uuid().nullable().optional(),
    stayDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    guestName: z.string().trim().min(1).max(128).nullable().optional(),
    rooms: z.array(reservationRoomInputSchema).max(20).optional(),
  })
  .strict()
export const reservationCreateSchema = reservationPatchSchema.omit({
  revision: true,
})
export const reservationActionSchema = z
  .object({ revision: z.number().int().positive() })
  .strict()
export const reservationFilterSchema = z.object({
  upcoming: z.enum(['true', 'false']).optional(),
  city: z.string().trim().min(1).max(128).optional(),
  brand: z.string().trim().min(1).max(128).optional(),
  status: z.enum(['draft', 'abandoned', 'confirmed']).optional(),
})
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
