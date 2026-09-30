import { Check, ClipboardList } from 'lucide-react'
import type { FloatingCardData } from '../cards/schema'
import { useReservation } from '../hooks/use-reservation'
import { FloatingCard } from './floating-card'
import { Button } from './ui/button'

const nextFieldLabel = {
  hotel: 'hotel',
  stayDate: 'stay date',
  rooms: 'rooms',
  guestName: 'guest name',
}

export function ReservationCard({
  reservation,
  onDismiss,
}: {
  reservation: Extract<FloatingCardData, { type: 'reservation' }>['reservation']
  onDismiss: () => void
}) {
  const { state, confirm, isMutating, error } = useReservation(reservation)
  const checkpoints = [
    { label: 'Hotel', done: state.hotelId !== null },
    { label: 'Date', done: state.stayDate !== null },
    { label: 'Rooms', done: state.rooms.length > 0 },
    { label: 'Guest', done: state.guestName !== null },
  ]

  return (
    <FloatingCard
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
      onDismiss={onDismiss}
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
          disabled={isMutating}
          onClick={() => void confirm().catch(() => {})}
        >
          Confirm reservation
        </Button>
      )}
    </FloatingCard>
  )
}
