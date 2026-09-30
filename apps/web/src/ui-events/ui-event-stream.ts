import { voiceUiEventSchema as uiEventSchema } from '@voice/contracts'
import type { z } from 'zod'
import type { AuthenticatedFetch } from '../lib/http'

export type UIEvent = z.infer<typeof uiEventSchema>

export interface UIEventHandlers {
  onEvent(event: UIEvent): void
  onError(message: string): void
}

/** Reads authenticated browser UI events independently of WebRTC media and lifecycle. */
export class UIEventStream {
  private readonly controller = new AbortController()
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private started = false

  constructor(
    private readonly handlers: UIEventHandlers,
    private readonly request: AuthenticatedFetch,
  ) {}

  async start(sessionId: string): Promise<void> {
    if (this.started) {
      throw new Error('UI event stream has already started')
    }

    this.started = true

    try {
      const response = await this.request({
        path: `/v1/voice/sessions/${sessionId}/ui-events`,
        method: 'GET',
        signal: this.controller.signal,
      })

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

  end(): void {
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

        if (this.controller.signal.aborted || chunk.done) {
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
    if (this.controller.signal.aborted) {
      return
    }

    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('\n')

    if (!data) {
      return
    }

    try {
      const event = uiEventSchema.safeParse(JSON.parse(data))

      if (event.success) {
        this.handlers.onEvent(event.data)
      }
    } catch {
      // Ignore malformed frames; a later valid event can still update the UI.
    }
  }
}
