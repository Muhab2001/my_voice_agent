import type { DrizzleClient } from './index.js'
import { voiceSessions } from './schema.js'

export interface VoiceSessionService {
  create(): Promise<string>
}

export class DrizzleVoiceSessionService implements VoiceSessionService {
  constructor(private readonly client: DrizzleClient) {}

  async create(): Promise<string> {
    const [session] = await this.client
      .insert(voiceSessions)
      .values({})
      .returning({ id: voiceSessions.id })

    return session.id
  }
}
