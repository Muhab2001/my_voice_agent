import { voiceUiEventSchema } from '@voice/contracts'
import { ApiClient } from '../lib/api-client'
import type { VoiceUiEvent } from './types'

export interface VoiceUiEventHandlers {
  onEvent(event: VoiceUiEvent): void
  onError(message: string): void
}

/** Reads authenticated browser UI events independently of WebRTC media and lifecycle. */
export class VoiceUiEventStream {
  private readonly controller = new AbortController()
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private started = false

  constructor(private readonly handlers: VoiceUiEventHandlers) {}

  async start(sessionId: string): Promise<void> {
    if (this.started) {
      throw new Error('UI event stream has already started')
    }

    this.started = true

    try {
      const response = await ApiClient.stream(
        `/v1/voice/sessions/${sessionId}/ui-events`,
        this.controller.signal,
      )

      if (this.controller.signal.aborted) {
        return
      }

      if (!response.body) {
        this.handlers.onError('Live updates are unavailable.')
        return
      }

      void this.read(response.body)
    } catch {
      if (!this.controller.signal.aborted) {
        this.handlers.onError('Live updates could not connect.')
      }
    }
  }

  stop(): void {
    this.controller.abort()
    void this.reader?.cancel().catch(() => {})
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    this.reader = reader
    const decoder = new TextDecoder()
    let buffer = ''
    let interrupted = false

    try {
      while (!this.controller.signal.aborted) {
        const chunk = await reader.read()

        if (chunk.done) {
          break
        }

        buffer += decoder.decode(chunk.value, { stream: true })
        buffer = buffer.replace(/\r\n/g, '\n')
        let boundary = buffer.indexOf('\n\n')

        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          this.handleFrame(frame)
          boundary = buffer.indexOf('\n\n')
        }
      }
    } catch {
      interrupted = true
    } finally {
      this.reader = undefined
      reader.releaseLock()

      if (!this.controller.signal.aborted) {
        this.handlers.onError(
          interrupted
            ? 'Live updates were interrupted.'
            : 'Live updates ended.',
        )
      }
    }
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('\n')

    if (!data) {
      return
    }

    try {
      const event = voiceUiEventSchema.safeParse(JSON.parse(data))

      if (event.success) {
        this.handlers.onEvent(event.data)
      }
    } catch {
      // Ignore malformed frames; a later valid event can still update the UI.
    }
  }
}
