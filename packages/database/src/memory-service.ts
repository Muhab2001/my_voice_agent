import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import { memories } from './schema.js'

export type MemoryInput = {
  content: string
  entity: string | null
  event_at: string | null
}

/** Filters are combined with AND. Null fields omit their corresponding filter. */
export type MemoryQuery = {
  /** First eight whitespace-separated keywords; each must occur as a case-insensitive substring. */
  query: string | null
  /** Exact entity label after trimming and lowercasing, rather than a substring match. */
  entity: string | null
  /** Inclusive lower bound on eventAt; undated memories do not match time filters. */
  from: string | null
  /** Inclusive upper bound on eventAt, independent of creation/update timestamps. */
  to: string | null
  /** Maximum rows returned; SQL limit is clamped to 1–20 and tool input is validated. */
  limit: number
}

export type Memory = typeof memories.$inferSelect

/** Shared durable facts, with bounded lookup and immediate, idempotent persistence. */
export interface MemoryService {
  /**
   * Match literal keywords, an exact entity label and optional event-time bounds; return at
   * most 20 facts.
   */
  search(input: MemoryQuery): Promise<Memory[]>

  /** Save an explicitly stated fact; identical normalized facts return the existing row. */
  remember(sessionId: string, input: MemoryInput): Promise<Memory>

  /** Replace a fact in place by ID; reject missing rows or conflicting duplicates. */
  correct(id: string, input: MemoryInput): Promise<Memory>
}

/** Hash normalized content/entity/event time to identify exact duplicates, not semantic similarity. */
export function memoryFingerprint(input: MemoryInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.content
          .normalize('NFKC')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase(),
        input.entity?.normalize('NFKC').trim().toLowerCase() ?? null,
        input.event_at ? new Date(input.event_at).toISOString() : null,
      ]),
    )
    .digest('hex')
}

/** PostgreSQL implementation of shared memory, including uniqueness enforcement. */
export class DrizzleMemoryService implements MemoryService {
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
