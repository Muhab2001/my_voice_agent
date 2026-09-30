import type { FloatingCardData } from '../cards/schema'
import { NearbyPlacesCard } from './nearby-places-card'
import { ReservationCard } from './reservation-card'
import { SuggestionsCard } from './suggestions-card'

/** Renders the typed card list in one shared stack. */
export function FloatingCards({
  cards,
  onDismiss,
}: {
  cards: FloatingCardData[]
  onDismiss: (id: string) => void
}) {
  return (
    <div className="fixed bottom-5 right-5 z-20 flex max-h-[calc(100dvh-2.5rem)] w-[min(370px,calc(100vw-2.5rem))] flex-col gap-3 overflow-y-auto sm:bottom-8 sm:right-8">
      {cards.map((card) => {
        const dismiss = () => onDismiss(card.id)

        switch (card.type) {
          case 'places':
            return (
              <NearbyPlacesCard
                key={card.id}
                places={card.places}
                onDismiss={dismiss}
              />
            )
          case 'reservation':
            return (
              <ReservationCard
                key={card.id}
                reservation={card.reservation}
                onDismiss={dismiss}
              />
            )
          case 'suggestions':
            return (
              <SuggestionsCard
                key={card.id}
                suggestions={card.suggestions}
                onDismiss={dismiss}
              />
            )
        }

        throw new Error(
          `Unsupported card: ${JSON.stringify(card satisfies never)}`,
        )
      })}
    </div>
  )
}
