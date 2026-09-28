import { z } from 'zod'

/** Public data-channel events only; private tool events remain on the server sideband. */
export const liveVoiceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.started') }),
  z.object({
    type: z.literal('session.closed'),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('error') }),
  z.object({
    type: z.literal('session.input_transcript.delta'),
    delta: z.string(),
  }),
  z.object({
    type: z.literal('session.output_transcript.delta'),
    delta: z.string(),
  }),
])
