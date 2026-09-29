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
])
