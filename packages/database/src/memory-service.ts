import { createHash } from 'node:crypto'
import type { memories } from './schema.js'

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
export interface MemoryStore {
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
