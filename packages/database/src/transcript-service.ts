import { asc, eq } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import { mergedTranscripts, transcriptSnapshots } from './schema.js'

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

  /** Read up to 5,000 merged speaker passages in timeline order, including historical snapshots. */
  read(sessionId: string): Promise<TranscriptSnapshot[]>
}

/** PostgreSQL implementation of idempotent transcript snapshots and merged reads. */
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

  /**
   * The view merges consecutive snapshots with the same speaker. Text is concatenated
   * verbatim; retain the first snapshot ID and earliest creation time for the passage.
   * Speaker changes split passages, including when that speaker resumes later.
   */
  async read(id: string) {
    return this.client
      .select()
      .from(mergedTranscripts)
      .where(eq(mergedTranscripts.sessionId, id))
      .orderBy(
        asc(mergedTranscripts.startMs),
        asc(mergedTranscripts.createdAt),
        asc(mergedTranscripts.id),
      )
      .limit(5000)
  }
}
