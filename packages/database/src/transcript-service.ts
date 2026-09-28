import { asc, eq } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import { transcriptSnapshots } from './schema.js'

export type Snapshot = {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  text: string
  startMs: number
  endMs: number
}

export type TranscriptSnapshot = typeof transcriptSnapshots.$inferSelect

/**
 * Text snapshot persistence; transcript buffering and flush timing belong to the session
 * manager.
 */
export interface TranscriptService {
  /** Append chunks using stable IDs so retries cannot save a chunk twice. */
  append(chunks: Snapshot[]): Promise<void>

  /** Read up to 5,000 chunks for a local session in timeline order. */
  read(sessionId: string): Promise<TranscriptSnapshot[]>
}

/** PostgreSQL implementation of idempotent transcript snapshots and ordered reads. */
export class DrizzleTranscriptService implements TranscriptService {
  constructor(private readonly client: DrizzleClient) {}

  async append(chunks: Snapshot[]) {
    if (chunks.length) {
      await this.client
        .insert(transcriptSnapshots)
        .values(chunks)
        .onConflictDoNothing()
    }
  }

  async read(id: string) {
    return this.client
      .select()
      .from(transcriptSnapshots)
      .where(eq(transcriptSnapshots.sessionId, id))
      .orderBy(
        asc(transcriptSnapshots.startMs),
        asc(transcriptSnapshots.createdAt),
        asc(transcriptSnapshots.id),
      )
      .limit(5000)
  }
}
