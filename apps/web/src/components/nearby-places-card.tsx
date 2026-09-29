import {
  BedDouble,
  Coffee,
  ExternalLink,
  MapPin,
  Trees,
  UtensilsCrossed,
} from 'lucide-react'
import type { PlaceCard } from '../ui-events/types'
import { FloatingCard } from './floating-card'

export function NearbyPlacesCard({
  card,
  onDismiss,
}: {
  card: PlaceCard
  onDismiss: () => void
}) {
  const category = {
    cafe: { label: 'Coffee shops', icon: Coffee },
    restaurant: { label: 'Restaurants', icon: UtensilsCrossed },
    hotel: { label: 'Hotels', icon: BedDouble },
    park: { label: 'Parks', icon: Trees },
    other: { label: card.query, icon: MapPin },
  }[card.category]
  const Icon = category.icon

  return (
    <FloatingCard
      title={category.label}
      note={card.note}
      icon={<Icon className="size-5" />}
      onDismiss={onDismiss}
    >
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {card.places.length === 0 && (
          <p className="py-3 text-sm text-[#68758a]">
            No places found in this area.
          </p>
        )}
        {card.places.map((place) => (
          <a
            key={place.url}
            href={place.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[#f5f7fc]"
          >
            <Icon className="size-4 shrink-0 text-[#788aab]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[#344155]">
                {place.name}
              </span>
              <span className="block truncate text-xs text-[#8793a5]">
                {place.address}
              </span>
            </span>
            <span className="shrink-0 text-right text-xs text-[#637189]">
              <span className="block">
                {place.distanceMeters === null
                  ? 'Distance —'
                  : place.distanceMeters < 1000
                    ? `${Math.round(place.distanceMeters)} m`
                    : `${(place.distanceMeters / 1000).toFixed(1)} km`}
              </span>
              <span className="block">
                {place.durationSeconds === null
                  ? 'Time —'
                  : `${Math.max(1, Math.ceil(place.durationSeconds / 60))} min ${card.travelMode === 'WALK' ? 'walk' : 'drive'}`}
              </span>
            </span>
            <ExternalLink className="size-3.5 shrink-0 text-[#9ba8ba] group-hover:text-primary" />
          </a>
        ))}
      </div>
    </FloatingCard>
  )
}
