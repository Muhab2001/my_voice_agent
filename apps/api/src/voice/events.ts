import { z } from 'zod'

const eventId = { event_id: z.string().optional() }
const transcript = {
  ...eventId,
  delta: z.string(),
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
}

const response = z.object({
  id: z.string().min(1).optional(),
  usage: z.record(z.unknown()).optional(),
  status: z.string().optional(),
})

const responseFields = {
  ...eventId,
  response_id: z.string().min(1).optional(),
  response: response.optional(),
}

/** Completed tool calls carry a stable identity and JSON arguments validated by the tool service. */
const functionCall = z.object({
  type: z.literal('function_call'),
  call_id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.string(),
})

/** Only backend events used by the manager are accepted; unrelated output items are ignored. */
export const responseEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...responseFields,
    type: z.literal('response.output_item.done'),
    item: functionCall,
  }),
  z.object({ ...responseFields, type: z.literal('response.completed') }),
  z.object({ ...responseFields, type: z.literal('response.done') }),
  z.object({ ...responseFields, type: z.literal('response.failed') }),
  z.object({ ...responseFields, type: z.literal('response.incomplete') }),
])

/** Validate network payloads once before dispatch. Unknown or malformed events are ignored. */
export const sidebandEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...transcript,
    type: z.literal('session.input_transcript.delta'),
  }),
  z.object({
    ...transcript,
    type: z.literal('session.output_transcript.delta'),
  }),
  z.object({
    ...eventId,
    type: z.literal('session.usage.updated'),
    usage: z.record(z.unknown()),
  }),
  z.object({
    ...eventId,
    type: z.literal('session.closed'),
    reason: z.string(),
    usage: z.record(z.unknown()).optional(),
  }),
  z.object({ ...eventId, type: z.literal('error') }),
  z.object({
    ...eventId,
    type: z.literal('session.delegation.created'),
    delegation: z.object({ id: z.string().min(1), target: z.string() }),
  }),
  z.object({
    ...eventId,
    type: z.literal('response.event'),
    delegation_id: z.string().min(1).optional(),
    event: responseEventSchema,
  }),
])

export type SidebandEvent = z.infer<typeof sidebandEventSchema>
export type ResponseEvent = z.infer<typeof responseEventSchema>
export type EventOf<T extends SidebandEvent['type']> = Extract<
  SidebandEvent,
  { type: T }
>
export type ResponseEventOf<T extends ResponseEvent['type']> = Extract<
  ResponseEvent,
  { type: T }
>
