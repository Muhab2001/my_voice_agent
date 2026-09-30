import type { voiceUiEventSchema } from '@voice/contracts'
import type { z } from 'zod'

type UiEvent = z.infer<typeof voiceUiEventSchema>
type Subscriber = {
  send: (event: UiEvent) => void
  close: () => void
}
/** Sends app UI events to the browser and replays the latest state on reconnect. */
export class UIEventChannel {
  private listeners = new Map<string, Set<Subscriber>>()
  private latest = new Map<string, UiEvent[]>()

  subscribe(
    sessionId: string,
    send: (event: UiEvent) => void,
    close: () => void,
  ): () => void {
    const subscriber = { send, close }
    const listeners = this.listeners.get(sessionId) ?? new Set()
    listeners.add(subscriber)
    this.listeners.set(sessionId, listeners)

    for (const event of this.latest.get(sessionId) ?? []) {
      send(event)
    }

    return () => {
      listeners.delete(subscriber)

      if (listeners.size === 0) {
        this.listeners.delete(sessionId)
      }
    }
  }

  emit(sessionId: string, event: UiEvent): void {
    const previous = this.latest.get(sessionId) ?? []
    this.latest.set(sessionId, [
      ...previous.filter((item) => item.type !== event.type),
      event,
    ])

    for (const subscriber of this.listeners.get(sessionId) ?? []) {
      subscriber.send(event)
    }
  }

  closeSession(sessionId: string): void {
    const listeners = this.listeners.get(sessionId)
    this.listeners.delete(sessionId)
    this.latest.delete(sessionId)

    for (const subscriber of listeners ?? []) {
      subscriber.close()
    }
  }
}
