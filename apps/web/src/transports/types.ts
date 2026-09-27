export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'paused'
  | 'error'
export type TranscriptItem = {
  id: string
  text: string
  fading?: boolean
}

export type VoiceTransportEvents = {
  onStatus: (status: VoiceStatus) => void
  onTranscript: (item: TranscriptItem) => void
  onInputLevel: (level: number) => void
  onAudioReady: () => void
  onAudioEnded: () => void
  onError: (message: string) => void
}

export interface VoiceTransport {
  start(): Promise<void>
  stop(): void
  setMuted(muted: boolean): void
  playIncoming(): Promise<void>
  pauseIncoming(): void
  isPlaying(): boolean
}

export type VoiceTransportFactory = (
  events: VoiceTransportEvents,
) => VoiceTransport
