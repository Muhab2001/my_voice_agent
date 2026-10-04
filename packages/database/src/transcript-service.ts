import type { transcriptSnapshots } from './schema.js'

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
export interface TranscriptStore {
  /** Append chunks using stable IDs so retries cannot save a chunk twice. */
  append(chunks: Snapshot[]): Promise<void>

  /** Read up to 5,000 merged speaker passages in timeline order, including historical snapshots. */
  read(sessionId: string): Promise<TranscriptSnapshot[]>
}
