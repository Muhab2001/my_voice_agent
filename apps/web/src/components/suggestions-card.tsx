import type {
  dateOptionSchema,
  hotelOptionSchema,
  offeringOptionSchema,
  reservationStateSchema,
} from '@voice/contracts'
import { BedDouble, Building2, CalendarDays, ClipboardList } from 'lucide-react'
import { useState } from 'react'
import type { z } from 'zod'
import type { SuggestionsCardData } from '../cards/schema'
import { FloatingCard } from './floating-card'
import { Button } from './ui/button'

const headings = {
  hotels: { title: 'Hotels', icon: Building2 },
  rooms: { title: 'Room options', icon: BedDouble },
  dates: { title: 'Available dates', icon: CalendarDays },
  reservations: { title: 'Reservations', icon: ClipboardList },
}

export function SuggestionsCard({
  suggestions,
  onDismiss,
}: {
  suggestions: SuggestionsCardData
  onDismiss: () => void
}) {
  const { title, icon: Icon } = headings[suggestions.kind]

  return (
    <FloatingCard
      title={title}
      icon={<Icon className="size-5" />}
      onDismiss={onDismiss}
    >
      <div className="max-h-56 space-y-1 overflow-y-auto text-sm text-[#526078]">
        <SuggestionsList suggestions={suggestions} />
      </div>
    </FloatingCard>
  )
}

function SuggestionsList({
  suggestions,
}: {
  suggestions: SuggestionsCardData
}) {
  const [page, setPage] = useState({ suggestions, count: 5 })
  const visibleCount = page.suggestions === suggestions ? page.count : 5

  if (!Array.isArray(suggestions.options)) {
    return <p className="py-2">{suggestions.options.message}</p>
  }

  if (suggestions.options.length === 0) {
    return (
      <p className="py-2">
        No {headings[suggestions.kind].title.toLowerCase()} found.
      </p>
    )
  }

  switch (suggestions.kind) {
    case 'hotels':
      return suggestions.options.map((hotel) => (
        <HotelSuggestion key={hotel.id} hotel={hotel} />
      ))
    case 'rooms':
      return suggestions.options.map((room) => (
        <RoomSuggestion key={room.id} room={room} />
      ))
    case 'dates':
      return suggestions.options.map((date) => (
        <DateSuggestion key={date.date} date={date} />
      ))
    case 'reservations':
      return (
        <>
          {suggestions.options.slice(0, visibleCount).map((reservation) => (
            <ReservationSuggestion
              key={reservation.id}
              reservation={reservation}
            />
          ))}
          {suggestions.options.length > visibleCount && (
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() => setPage({ suggestions, count: visibleCount + 5 })}
            >
              Load more
            </Button>
          )}
        </>
      )
  }
}

function HotelSuggestion({
  hotel,
}: {
  hotel: z.infer<typeof hotelOptionSchema>
}) {
  return (
    <div className="rounded-xl px-2 py-2 hover:bg-[#f5f7fc]">
      <p className="font-medium text-[#344155]">{hotel.locationName}</p>
      <p className="text-xs text-[#8793a5]">{hotel.city}</p>
    </div>
  )
}

function RoomSuggestion({
  room,
}: {
  room: z.infer<typeof offeringOptionSchema>
}) {
  return (
    <div className="flex justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[#f5f7fc]">
      <span className="font-medium text-[#344155]">{room.name}</span>
      <span className="shrink-0 text-right text-xs">
        SAR {room.priceSar}
        <span className="block">{room.available} available</span>
      </span>
    </div>
  )
}

function DateSuggestion({ date }: { date: z.infer<typeof dateOptionSchema> }) {
  return (
    <div className="flex justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[#f5f7fc]">
      <span className="font-medium text-[#344155]">{date.date}</span>
      <span className="text-right text-xs">
        {date.availableRooms} rooms available
      </span>
    </div>
  )
}

function ReservationSuggestion({
  reservation,
}: {
  reservation: z.infer<typeof reservationStateSchema>
}) {
  return (
    <div className="rounded-xl px-2 py-2 hover:bg-[#f5f7fc]">
      <p className="font-medium text-[#344155]">
        {reservation.hotel ?? 'Hotel pending'} ·{' '}
        {reservation.stayDate ?? 'Date pending'}
      </p>
      <p className="text-xs capitalize text-[#8793a5]">
        {reservation.status} · {reservation.guestName ?? 'Guest pending'} · SAR{' '}
        {reservation.confirmedTotalSar ?? reservation.quotedTotalSar ?? '—'}
      </p>
    </div>
  )
}
