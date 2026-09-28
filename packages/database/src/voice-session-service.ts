import { eq } from 'drizzle-orm'
import type { DrizzleClient } from './index.js'
import { voiceSessions } from './schema.js'

export type Session = typeof voiceSessions.$inferSelect

export type SessionUpdate = Partial<
  Pick<
    Session,
    | 'vendorSessionId'
    | 'status'
    | 'endedAt'
    | 'endReason'
    | 'finalization'
    | 'usage'
    | 'error'
  >
>

/** Local voice-session records, separate from provider connections, transcripts and memories. */
export interface VoiceSessionService {
  /** Allocate a local session UUID before contacting the voice provider. */
  create(): Promise<string>

  /** Persist provider identity, lifecycle status, usage or finalization details. */
  update(id: string, patch: SessionUpdate): Promise<void>

  /** Read a local session; return undefined only when the record does not exist. */
  get(id: string): Promise<Session | undefined>
}

/** PostgreSQL implementation of local voice-session lifecycle records. */
export class DrizzleVoiceSessionService implements VoiceSessionService {
  constructor(private readonly client: DrizzleClient) {}

  async create() {
    const [row] = await this.client.insert(voiceSessions).values({}).returning()
    return row.id
  }

  async update(id: string, patch: SessionUpdate) {
    await this.client
      .update(voiceSessions)
      .set(patch)
      .where(eq(voiceSessions.id, id))
  }

  async get(id: string) {
    const [row] = await this.client
      .select()
      .from(voiceSessions)
      .where(eq(voiceSessions.id, id))
    return row
  }
}
