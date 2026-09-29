import {
  dateOptionSchema,
  hotelOptionSchema,
  offeringOptionSchema,
  reservationStateSchema,
} from '@voice/contracts'
import {
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  ClipboardList,
} from 'lucide-react'
import { useState } from 'react'
import type { z } from 'zod'
import type { ReservationOptions } from '../ui-events/types'
import { FloatingCard } from './floating-card'
import { Button } from './ui/button'

type State = z.infer<typeof reservationStateSchema>
type Props = {
  state: State | null
  options: ReservationOptions | null
  busy: boolean
  error: string | null
  confirm: () => Promise<void>
  dismissState: () => void
  dismissOptions: () => void
}

const nextFieldLabel = {
  hotel: 'hotel',
  stayDate: 'stay date',
  rooms: 'rooms',
  guestName: 'guest name',
}

const headings = {
  hotels: { title: 'Hotels', icon: <Building2 className="size-5" /> },
  rooms: { title: 'Room options', icon: <BedDouble className="size-5" /> },
  dates: {
    title: 'Available dates',
    icon: <CalendarDays className="size-5" />,
  },
  reservations: {
    title: 'Reservations',
    icon: <ClipboardList className="size-5" />,
  },
}

export function ReservationPanel({
  state,
  options,
  busy,
  error,
  confirm,
  dismissState,
  dismissOptions,
}: Props) {
  const [visible, setVisible] = useState({ options, count: 5 })
  const visibleResults = visible.options === options ? visible.count : 5
  const choices = Array.isArray(options?.options) ? options.options : []
  const rawMessage = options?.options
  const message =
    rawMessage &&
    typeof rawMessage === 'object' &&
    'message' in rawMessage &&
    typeof rawMessage.message === 'string'
      ? rawMessage.message
      : null
  const hotels = choices.filter(
    (item) => hotelOptionSchema.safeParse(item).success,
  ) as z.infer<typeof hotelOptionSchema>[]
  const rooms = choices.filter(
    (item) => offeringOptionSchema.safeParse(item).success,
  ) as z.infer<typeof offeringOptionSchema>[]
  const dates = choices.filter(
    (item) => dateOptionSchema.safeParse(item).success,
  ) as z.infer<typeof dateOptionSchema>[]
  const results = choices.filter(
    (item) => reservationStateSchema.safeParse(item).success,
  ) as State[]
  const heading = options ? headings[options.kind] : null
  const checkpoints = state
    ? [
        { label: 'Hotel', done: state.hotelId !== null },
        { label: 'Date', done: state.stayDate !== null },
        { label: 'Rooms', done: state.rooms.length > 0 },
        { label: 'Guest', done: state.guestName !== null },
      ]
    : []

  return (
    <div className="fixed bottom-5 right-5 z-20 flex max-h-[calc(100dvh-2.5rem)] w-[min(370px,calc(100vw-2.5rem))] flex-col gap-3 overflow-y-auto sm:bottom-8 sm:right-8">
      {state && (
        <FloatingCard
          stacked
          title="Reservation"
          note={
            state.status === 'draft'
              ? state.nextMissingField
                ? `Next: ${nextFieldLabel[state.nextMissingField]}`
                : 'Ready for your confirmation'
              : state.status === 'confirmed'
                ? 'Confirmed stay'
                : 'Unfinished stay'
          }
          icon={<ClipboardList className="size-5" />}
          onDismiss={dismissState}
        >
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f6f8fb] px-2 py-3">
            {checkpoints.map((checkpoint) => (
              <div
                key={checkpoint.label}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`flex size-5 items-center justify-center rounded-full ${checkpoint.done ? 'bg-emerald-500 text-white' : 'border border-[#cbd3df] bg-[#e6eaf0]'}`}
                >
                  {checkpoint.done && (
                    <Check aria-hidden="true" className="size-3 stroke-[3]" />
                  )}
                </span>
                <span className="text-[11px] text-[#758298]">
                  {checkpoint.label}
                </span>
                <span className="sr-only">
                  {checkpoint.done ? 'complete' : 'pending'}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-2 text-sm text-[#526078]">
            <div className="flex justify-between gap-3">
              <span>Hotel</span>
              <span className="text-right font-medium text-[#344155]">
                {state.hotel ?? 'Pending'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Stay date</span>
              <span className="font-medium text-[#344155]">
                {state.stayDate ?? 'Pending'}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span>Guest</span>
              <span className="text-right font-medium text-[#344155]">
                {state.guestName ?? 'Pending'}
              </span>
            </div>
            {state.rooms.map((room) => (
              <div key={room.offeringId} className="flex justify-between gap-3">
                <span>
                  {room.quantity} × {room.name} · SAR {room.unitPriceSar}
                </span>
                <span className="shrink-0">SAR {room.lineTotalSar}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-[#edf0f5] pt-2 font-semibold text-[#344155]">
              <span>One-night total</span>
              <span>
                SAR {state.confirmedTotalSar ?? state.quotedTotalSar ?? '—'}
              </span>
            </div>
          </div>
          {state.reason && (
            <p className="mt-3 text-sm text-[#68758a]">{state.reason}</p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-[#c44858]">
              {error}
            </p>
          )}
          {state.status === 'draft' && state.nextMissingField === null && (
            <Button
              className="mt-4 w-full"
              disabled={busy}
              onClick={() => void confirm()}
            >
              Confirm reservation
            </Button>
          )}
        </FloatingCard>
      )}
      {options && heading && (
        <FloatingCard
          stacked
          title={heading.title}
          icon={heading.icon}
          onDismiss={dismissOptions}
        >
          <div className="max-h-56 space-y-1 overflow-y-auto text-sm text-[#526078]">
            {message && <p className="py-2">{message}</p>}
            {!message && choices.length === 0 && (
              <p className="py-2">No {heading.title.toLowerCase()} found.</p>
            )}
            {hotels.map((hotel) => (
              <div
                key={hotel.id}
                className="rounded-xl px-2 py-2 hover:bg-[#f5f7fc]"
              >
                <p className="font-medium text-[#344155]">
                  {hotel.locationName}
                </p>
                <p className="text-xs text-[#8793a5]">{hotel.city}</p>
              </div>
            ))}
            {rooms.map((room) => (
              <div
                key={room.id}
                className="flex justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[#f5f7fc]"
              >
                <span className="font-medium text-[#344155]">{room.name}</span>
                <span className="shrink-0 text-right text-xs">
                  SAR {room.priceSar}
                  <span className="block">{room.available} available</span>
                </span>
              </div>
            ))}
            {dates.map((date) => (
              <div
                key={date.date}
                className="flex justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[#f5f7fc]"
              >
                <span className="font-medium text-[#344155]">{date.date}</span>
                <span className="text-right text-xs">
                  {date.availableRooms} rooms available
                </span>
              </div>
            ))}
            {results.slice(0, visibleResults).map((item) => (
              <div
                key={item.id}
                className="rounded-xl px-2 py-2 hover:bg-[#f5f7fc]"
              >
                <p className="font-medium text-[#344155]">
                  {item.hotel ?? 'Hotel pending'} ·{' '}
                  {item.stayDate ?? 'Date pending'}
                </p>
                <p className="text-xs capitalize text-[#8793a5]">
                  {item.status} · {item.guestName ?? 'Guest pending'} · SAR{' '}
                  {item.confirmedTotalSar ?? item.quotedTotalSar ?? '—'}
                </p>
              </div>
            ))}
            {results.length > visibleResults && (
              <Button
                variant="outline"
                className="mt-2 w-full"
                onClick={() =>
                  setVisible({ options, count: visibleResults + 5 })
                }
              >
                Load more
              </Button>
            )}
          </div>
        </FloatingCard>
      )}
    </div>
  )
}
