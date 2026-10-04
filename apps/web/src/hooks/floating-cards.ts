import { useCallback, useState } from 'react'
import { type FloatingCardData, floatingCardSchema } from '../cards/schema'
import type { UIEvent } from './ui-event-stream'

/** Owns the cards shown by tool events and removes them by identity on dismissal. */
export function useFloatingCards() {
  const [cards, setCards] = useState(() => new Map<string, FloatingCardData>())

  const receive = useCallback((event: UIEvent) => {
    let input: unknown

    switch (event.type) {
      case 'place-card':
        input = {
          id: `places:${event.card.id}`,
          type: 'places',
          places: event.card,
        }
        break
      case 'reservation-state':
        input = {
          id: `reservation:${event.reservation.id}`,
          type: 'reservation',
          reservation: event.reservation,
        }
        break
      case 'reservation-options':
        input = {
          id: `suggestions:${event.kind}`,
          type: 'suggestions',
          suggestions: { kind: event.kind, options: event.options },
        }
        break
    }

    const parsed = floatingCardSchema.safeParse(input)

    if (!parsed.success) {
      return
    }

    const next = parsed.data
    setCards((current) => {
      const existing = current.get(next.id)

      if (
        existing?.type === 'reservation' &&
        next.type === 'reservation' &&
        existing.reservation.revision > next.reservation.revision
      ) {
        return current
      }

      return new Map(current).set(next.id, next)
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setCards((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])

  const clear = useCallback(() => setCards(new Map()), [])

  return { cards: [...cards.values()], receive, dismiss, clear }
}
