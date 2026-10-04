import type { DrizzleClient, Snapshot, TranscriptStore } from '@voice/database'
import { mergedTranscripts, transcriptSnapshots } from '@voice/database/schema'
import { asc, eq } from 'drizzle-orm'

/** PostgreSQL implementation of idempotent transcript snapshots and merged reads. */
export class TranscriptService implements TranscriptStore {
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
