import type {
  locationToolReplySchema,
  voiceUiEventSchema,
} from '@voice/contracts'
import type { z } from 'zod'

type Reply = z.infer<typeof locationToolReplySchema>
type UiEvent = z.infer<typeof voiceUiEventSchema>
type Subscriber = {
  send: (event: UiEvent) => void
  close: () => void
}
type Pending = {
  requestId: string
  resolve: (reply: Reply) => void
  promise: Promise<Reply>
  timer: ReturnType<typeof setTimeout>
}

/** Sends app UI events to the browser and resolves browser-assisted tool calls. */
export class UIEventChannel {
  private listeners = new Map<string, Set<Subscriber>>()
  private pending = new Map<string, Pending>()

  subscribe(
    sessionId: string,
    send: (event: UiEvent) => void,
    close: () => void,
  ): () => void {
    const subscriber = { send, close }
    const listeners = this.listeners.get(sessionId) ?? new Set()
    listeners.add(subscriber)
    this.listeners.set(sessionId, listeners)
    const pending = this.pending.get(sessionId)

    if (pending) {
      send({ type: 'location-request', requestId: pending.requestId })
    }

    return () => {
      listeners.delete(subscriber)

      if (listeners.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  emit(sessionId: string, event: UiEvent): void {
    for (const subscriber of this.listeners.get(sessionId) ?? []) {
      subscriber.send(event)
    }
  }

  requestLocation(sessionId: string): Promise<Reply> {
    const existing = this.pending.get(sessionId)

    if (existing) {
      return existing.promise
    }

    const requestId = crypto.randomUUID()
    let resolve!: (reply: Reply) => void
    const promise = new Promise<Reply>((done) => {
      resolve = done
    })
    const timer = setTimeout(() => {
      this.reply(sessionId, requestId, { status: 'denied' })
    }, 60_000)
    this.pending.set(sessionId, { requestId, resolve, promise, timer })
    this.emit(sessionId, { type: 'location-request', requestId })
    return promise
  }

  requestId(sessionId: string): string | null {
    return this.pending.get(sessionId)?.requestId ?? null
  }

  reply(sessionId: string, requestId: string, reply: Reply): boolean {
    const pending = this.pending.get(sessionId)

    if (!pending || pending.requestId !== requestId) {
      return false
    }

    clearTimeout(pending.timer)
    this.pending.delete(sessionId)
    pending.resolve(reply)
    return true
  }

  closeSession(sessionId: string): void {
    const pending = this.pending.get(sessionId)

    if (pending) {
      this.reply(sessionId, pending.requestId, { status: 'denied' })
    }

    const listeners = this.listeners.get(sessionId)
    this.listeners.delete(sessionId)

    for (const subscriber of listeners ?? []) {
      subscriber.close()
    }
  }
}
