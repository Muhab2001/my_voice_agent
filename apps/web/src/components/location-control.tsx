import { MapPin, X } from 'lucide-react'
import type { useLocationTracking } from '../hooks/use-location-tracking'
import { Button } from './ui/button'

type LocationState = ReturnType<typeof useLocationTracking>

export function LocationControl({ location }: { location: LocationState }) {
  return (
    <>
      <div className="relative flex items-center gap-1">
        {location.enabled ? (
          <span
            role="status"
            aria-label="Location sharing enabled"
            className="flex size-10 items-center justify-center text-primary"
          >
            <MapPin className="size-[18px]" />
          </span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => void location.enable()}
            aria-label="Enable location access"
            aria-expanded={location.popupOpen}
            className="size-10 rounded-full text-[#68758a] shadow-none"
          >
            <MapPin className="size-[18px]" />
          </Button>
        )}
        {location.popupOpen && (
          <div className="absolute right-0 top-full z-30 mt-3 w-72 rounded-2xl border border-[#e1e6ef] bg-white p-4 text-[#344155] shadow-[0_14px_45px_rgba(37,51,73,0.16)]">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold">Location access</h2>
                <p className="mt-1 text-xs leading-relaxed text-[#68758a]">
                  {location.pending
                    ? 'The assistant needs your location to continue.'
                    : 'Share your position for nearby places.'}
                </p>
              </div>
              <button
                type="button"
                onClick={location.closePopup}
                aria-label="Close location settings"
                className="rounded-lg p-1 text-[#8793a5] hover:bg-[#f2f5fa]"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Allow location</span>
              <button
                type="button"
                role="switch"
                aria-checked={location.enabled}
                aria-label="Allow location access"
                disabled={location.busy || location.enabled}
                onClick={() => void location.enable()}
                className={`relative h-6 w-11 rounded-full transition-colors ${location.enabled ? 'bg-primary' : 'bg-[#c5cedb]'}`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform ${location.enabled ? 'translate-x-5' : 'translate-x-0'}`}
                />
              </button>
            </div>
            {location.pending && location.enabled && (
              <button
                type="button"
                onClick={() => void location.enable()}
                className="mt-3 text-xs font-medium text-primary hover:underline"
              >
                Share current location
              </button>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-[#8a97a8]">
              Browser permission can be changed in site settings.
            </p>
          </div>
        )}
      </div>
      <div
        role="status"
        className={`pointer-events-none fixed left-1/2 top-20 z-40 -translate-x-1/2 rounded-full bg-[#243349] px-5 py-3 text-center text-sm text-white shadow-lg transition-all duration-500 ${location.notice ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'}`}
      >
        {location.notice}
      </div>
    </>
  )
}
