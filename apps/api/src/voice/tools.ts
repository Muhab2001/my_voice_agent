import type { MemoryService } from '@voice/database'
import type { FunctionTool } from 'openai/resources/responses/responses'
import { z } from 'zod'

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
    'Save one durable fact or preference explicitly stated by the user. Search first to avoid duplicate facts. Use null for unknown metadata.',
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
