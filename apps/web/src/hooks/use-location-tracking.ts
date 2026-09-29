import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiClient } from '../lib/api-client'

const legacyOptOutKey = 'sarjy-location-opted-out'
type PendingRequest = { sessionId: string; requestId: string }

function browserPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is unavailable'))
      return
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    })
  })
}

function coordinates(position: GeolocationPosition) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
  }
}

export function useLocationTracking() {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingRequest | null>(null)
  const interval = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)
  const attempt = useRef(false)
  const pendingRef = useRef<PendingRequest | null>(null)

  const showNotice = useCallback((message: string) => {
    setNotice(message)

    if (noticeTimer.current !== null) {
      window.clearTimeout(noticeTimer.current)
    }

    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000)
  }, [])

  const stopUpdates = useCallback(() => {
    if (interval.current !== null) {
      window.clearInterval(interval.current)
      interval.current = null
    }

    setEnabled(false)
  }, [])

  const answerPending = useCallback(
    async (
      reply:
        | { status: 'denied' }
        | ({ status: 'granted' } & ReturnType<typeof coordinates>),
    ) => {
      const request = pendingRef.current

      if (!request) {
        return false
      }

      await ApiClient.post(
        `/v1/voice/sessions/${request.sessionId}/location/${request.requestId}`,
        reply,
        { parse: () => undefined },
      )

      if (pendingRef.current?.requestId === request.requestId) {
        pendingRef.current = null
        setPending(null)
      }

      return true
    },
    [],
  )

  const updatePosition = useCallback(async () => {
    const position = coordinates(await browserPosition())
    const answered = await answerPending({ status: 'granted', ...position })

    if (!answered) {
      await ApiClient.post('/v1/location', position, { parse: () => undefined })
    }
  }, [answerPending])

  const startUpdates = useCallback(() => {
    if (interval.current !== null) {
      return
    }

    interval.current = window.setInterval(() => {
      void updatePosition().catch(() => {
        stopUpdates()
        showNotice('Location update failed. Check browser permissions.')
      })
    }, 10 * 60_000)
  }, [showNotice, stopUpdates, updatePosition])

  const enable = useCallback(async () => {
    if (attempt.current) {
      return
    }

    attempt.current = true
    setBusy(true)

    try {
      await updatePosition()
      localStorage.removeItem(legacyOptOutKey)
      setEnabled(true)
      setPopupOpen(false)
      startUpdates()
      showNotice('Location is available for nearby searches.')
    } catch {
      stopUpdates()
      void answerPending({ status: 'denied' }).catch(() => {})
      setPopupOpen(true)
      showNotice('Location is unavailable. Check browser permissions.')
    } finally {
      attempt.current = false
      setBusy(false)
    }
  }, [answerPending, showNotice, startUpdates, stopUpdates, updatePosition])

  const closePopup = useCallback(() => {
    setPopupOpen(false)
    void answerPending({ status: 'denied' }).catch(() => {})
  }, [answerPending])

  const requestFromTool = useCallback(
    (sessionId: string, requestId: string) => {
      const request = { sessionId, requestId }
      pendingRef.current = request
      setPending(request)
      setPopupOpen(true)
    },
    [],
  )

  useEffect(() => {
    let active = true

    void (async () => {
      const previouslyOptedOut =
        localStorage.getItem(legacyOptOutKey) === 'true'

      try {
        const permission = await navigator.permissions.query({
          name: 'geolocation',
        })

        if (!active) {
          return
        }

        if (permission.state === 'granted' && !previouslyOptedOut) {
          void enable()
        } else {
          setPopupOpen(true)
        }
      } catch {
        if (active) {
          setPopupOpen(true)
        }
      }
    })()

    return () => {
      active = false

      if (interval.current !== null) {
        window.clearInterval(interval.current)
      }

      if (noticeTimer.current !== null) {
        window.clearTimeout(noticeTimer.current)
      }
    }
  }, [enable])

  return {
    enabled,
    busy,
    popupOpen,
    notice,
    pending: pending !== null,
    enable,
    closePopup,
    requestFromTool,
  }
}
