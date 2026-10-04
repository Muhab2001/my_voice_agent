import {
  type DrizzleClient,
  type MemoryInput,
  type MemoryQuery,
  type MemoryStore,
  memoryFingerprint,
} from '@voice/database'
import { memories } from '@voice/database/schema'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'

/** PostgreSQL implementation of shared memory, including uniqueness enforcement. */
export class MemoryService implements MemoryStore {
  constructor(private readonly client: DrizzleClient) {}

  /**
   * SELECT memories using parameterized AND predicates. Each keyword becomes
   * content ILIKE '%keyword%' with %, _ and backslash escaped as literal characters.
   * Optional entity uses lower(entity) equality; event bounds use >= and <=.
   * Results sort by updatedAt descending, then ID ascending, with a bounded LIMIT.
   * An empty query with no other filters returns the most recently updated facts.
   */
  async search(input: MemoryQuery) {
    const filters = []
    // Literal, bounded keywords; parameterized SQL with escaped LIKE metacharacters.
    const literalKeyword = (value: string) => value.replace(/[\\%_]/g, '\\$&')

    for (const word of input.query
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 8) ?? []) {
      filters.push(
        sql`${memories.content} ilike ${`%${literalKeyword(word)}%`} escape '\\'`,
      )
    }

    if (input.entity) {
      filters.push(
        sql`lower(${memories.entity}) = ${input.entity.trim().toLowerCase()}`,
      )
    }

    if (input.from) {
      filters.push(gte(memories.eventAt, new Date(input.from)))
    }

    if (input.to) {
      filters.push(lte(memories.eventAt, new Date(input.to)))
    }

    return this.client
      .select()
      .from(memories)
      .where(and(...filters))
      .orderBy(desc(memories.updatedAt), asc(memories.id))
      .limit(Math.min(20, Math.max(1, input.limit)))
  }

  /**
   * INSERT ... ON CONFLICT (fingerprint) DO NOTHING RETURNING the saved row.
   * A conflict triggers SELECT by fingerprint, so concurrent identical saves return
   * the same memory ID and preserve its original source session and timestamps.
   */
  async remember(sessionId: string, input: MemoryInput) {
    const fingerprint = memoryFingerprint(input)
    const [inserted] = await this.client
      .insert(memories)
      .values({
        sourceSessionId: sessionId,
        content: input.content.trim(),
        entity: input.entity?.trim() ?? null,
        eventAt: input.event_at ? new Date(input.event_at) : null,
        fingerprint,
      })
      .onConflictDoNothing({ target: memories.fingerprint })
      .returning()

    if (inserted) {
      return inserted
    }

    const [existing] = await this.client
      .select()
      .from(memories)
      .where(eq(memories.fingerprint, fingerprint))

    if (!existing) {
      throw new Error('Memory save could not be confirmed')
    }

    return existing
  }

  /**
   * UPDATE ... WHERE id = memory ID RETURNING the row. Replace content, entity,
   * eventAt and fingerprint, and refresh updatedAt; retain createdAt and sourceSessionId.
   * A missing ID throws; a fingerprint conflict fails the write without changing the row.
   */
  async correct(id: string, input: MemoryInput) {
    const [row] = await this.client
      .update(memories)
      .set({
        content: input.content.trim(),
        entity: input.entity?.trim() ?? null,
        eventAt: input.event_at ? new Date(input.event_at) : null,
        fingerprint: memoryFingerprint(input),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id))
      .returning()

    if (!row) {
      throw new Error('Memory does not exist')
    }

    return row
  }
}
