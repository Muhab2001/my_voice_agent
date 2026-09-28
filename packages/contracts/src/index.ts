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
