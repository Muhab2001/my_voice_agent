import type {
  DrizzleClient,
  SessionUpdate,
  VoiceSessionStore,
} from '@voice/database'
import { voiceSessions } from '@voice/database/schema'
import { eq } from 'drizzle-orm'

/** PostgreSQL implementation of local voice-session lifecycle records. */
export class VoiceSessionService implements VoiceSessionStore {
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
