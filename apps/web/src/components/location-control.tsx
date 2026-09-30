import { MapPin } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { useLocationTracking } from '../hooks/use-location-tracking'
import { Button } from './ui/button'

type LocationState = ReturnType<typeof useLocationTracking>

/** Requires a saved location before the authenticated app can be used. */
export function LocationControl({ location }: { location: LocationState }) {
  const ready = Boolean(location.data) && !location.error

  return (
    <Dialog.Root
      open={
        !ready &&
        location.permission !== 'checking' &&
        (location.permission !== 'granted' || Boolean(location.error))
      }
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[#243349]/35 backdrop-blur-sm" />
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[min(90vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#e1e6ef] bg-white p-6 text-[#344155] shadow-xl"
        >
          <MapPin className="mb-4 size-7 text-primary" />
          <Dialog.Title className="text-lg font-semibold">
            Enable location to continue
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-[#68758a]">
            Share your location so the assistant can find nearby places. Allow
            location access in your browser to continue into the app.
          </Dialog.Description>
          {location.error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              Could not save your location. Check your browser location
              permissions and connection, then try again.
            </p>
          )}
          <Button
            type="button"
            disabled={location.isValidating}
            onClick={() => void location.mutate().catch(() => {})}
            className="mt-5 w-full"
          >
            {location.isValidating ? 'Saving location…' : 'Enable location'}
          </Button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
