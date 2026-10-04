import type { voiceSessions } from './schema.js'

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
export interface VoiceSessionStore {
  /** Allocate a local session UUID before contacting the voice provider. */
  create(): Promise<string>

  /** Persist provider identity, lifecycle status, usage or finalization details. */
  update(id: string, patch: SessionUpdate): Promise<void>

  /** Read a local session; return undefined only when the record does not exist. */
  get(id: string): Promise<Session | undefined>
}
