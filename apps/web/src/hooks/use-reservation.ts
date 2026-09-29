import { reservationStateSchema } from '@voice/contracts'
import { useCallback, useEffect, useState } from 'react'
import type { z } from 'zod'
import { ApiClient } from '../lib/api-client'
import type { ReservationOptions } from '../ui-events/types'

type State = z.infer<typeof reservationStateSchema>

/** The browser follows agent updates and can also send an explicit confirmation. */
export function useReservation() {
  const [state, setState] = useState<State | null>(null)
  const [options, setOptions] = useState<ReservationOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showState, setShowState] = useState(false)
  const [showOptions, setShowOptions] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setState(
        await ApiClient.get({
          path: '/v1/reservations/active',
          schema: reservationStateSchema.nullable(),
          authenticated: true,
        }),
      )
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not load reservation',
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const confirm = useCallback(async () => {
    if (state?.status !== 'draft') {
      return
    }

    setBusy(true)
    setError(null)

    try {
      setState(
        await ApiClient.post(
          `/v1/reservations/${state.id}/confirm`,
          { revision: state.revision },
          reservationStateSchema,
        ),
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not confirm reservation',
      )
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [state, refresh])

  const receiveState = useCallback((value: unknown) => {
    const parsed = reservationStateSchema.safeParse(value)

    if (parsed.success) {
      setState((current) =>
        !current ||
        current.id !== parsed.data.id ||
        current.revision <= parsed.data.revision
          ? parsed.data
          : current,
      )
      setShowState(true)
    }
  }, [])

  const receiveOptions = useCallback((value: ReservationOptions) => {
    setOptions(value)
    setShowOptions(true)
  }, [])

  const hide = useCallback(() => {
    setShowState(false)
    setShowOptions(false)
    setOptions(null)
    setError(null)
  }, [])

  const dismissState = useCallback(() => setShowState(false), [])
  const dismissOptions = useCallback(() => setShowOptions(false), [])

  return {
    state: showState ? state : null,
    options: showOptions ? options : null,
    visible: showState || showOptions,
    error,
    busy,
    confirm,
    refresh,
    receiveState,
    receiveOptions,
    hide,
    dismissState,
    dismissOptions,
  }
}
