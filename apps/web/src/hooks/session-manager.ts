import { voiceAnswerSchema, voiceStatusSchema } from '@voice/contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { z } from 'zod'
import { readJSON, useApi } from './api'

/** Session-owned WebRTC resources. Subscribers detach when the signal aborts. */
export type SessionConnection = {
  peer: RTCPeerConnection
  channel: RTCDataChannel
  signal: AbortSignal
}

const sessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session.started') }),
  z.object({
    type: z.literal('session.closed'),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal('error') }),
])

type Session = z.infer<typeof voiceAnswerSchema>
type Status =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'stopping'
  | 'ended'
  | 'failed'

/** Owns WebRTC negotiation, connection lifetime, and API session lifecycle. */
export function useSessionManager() {
  const api = useApi()
  const current = useRef<Session | null>(null)
  const connection = useRef<SessionConnection | null>(null)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef<{
    result: Promise<Session | null>
    canceled: boolean
  } | null>(null)
  const ending = useRef<Promise<void> | null>(null)
  const detach = useRef<(() => void) | null>(null)
  const mounted = useRef(true)
  const failures = useRef(0)
  const [id, setId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)

  const closeConnection = useCallback(() => {
    const active = connection.current
    connection.current = null
    controller.current?.abort()
    controller.current = null
    active?.channel.close()
    active?.peer.close()
  }, [])

  const prepare = useCallback((): SessionConnection | null => {
    if (ending.current || pending.current?.canceled) {
      return null
    }

    if (connection.current) {
      return null
    }

    const peer = new RTCPeerConnection()
    const channel = peer.createDataChannel('oai-events')
    const cancellation = new AbortController()
    controller.current = cancellation
    const next = { peer, channel, signal: cancellation.signal }
    connection.current = next
    setError(null)
    setStatus('connecting')
    return next
  }, [])

  const { data } = useSWR(
    id && status !== 'stopping' ? `/v1/voice/sessions/${id}` : null,
    async (path: `/v1/voice/sessions/${string}`) =>
      readJSON(await api({ path, method: 'GET' }), voiceStatusSchema),
    {
      refreshInterval: 2000,
      errorRetryCount: 2,
      errorRetryInterval: 2000,
      revalidateOnFocus: false,
      onSuccess: (result) => {
        failures.current = 0

        if (result.status === 'failed') {
          setError(result.error ?? 'The voice session failed.')
        }

        if (result.status === 'failed' || result.status === 'ended') {
          setStatus(result.status)
        }
      },
      onError: () => {
        failures.current += 1

        if (failures.current >= 3) {
          setError('Could not reach the voice server.')
          setStatus('failed')
        }
      },
    },
  )

  const finalize = useCallback(
    async (sessionId: string, signal: AbortSignal) => {
      await readJSON(
        await api({
          path: `/v1/voice/sessions/${sessionId}/end`,
          method: 'POST',
          signal,
        }),
        z.undefined(),
      )
      return readJSON(
        await api({
          path: `/v1/voice/sessions/${sessionId}`,
          method: 'GET',
          signal,
        }),
        voiceStatusSchema,
      )
    },
    [api],
  )

  const end = useCallback((): Promise<void> => {
    if (ending.current) {
      return ending.current
    }

    detach.current?.()
    detach.current = null
    closeConnection()

    if (mounted.current) {
      setStatus('stopping')
    }

    ending.current = (async () => {
      await Promise.resolve()
      let timeout: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()

      try {
        await Promise.race([
          (async () => {
            await pending.current?.result.catch(() => null)

            if (controller.signal.aborted) {
              return
            }

            const session = current.current
            current.current = null

            if (!session) {
              return
            }

            const result = await finalize(session.id, controller.signal)

            if (
              mounted.current &&
              !controller.signal.aborted &&
              (result.error || result.finalization !== 'confirmed')
            ) {
              setError(
                result.error ?? 'Session finalization could not be confirmed.',
              )
            }
          })(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Session close timed out')),
              12_000,
            )
          }),
        ])
      } catch {
        if (mounted.current) {
          setError('Session finalization could not be confirmed.')
        }
      } finally {
        clearTimeout(timeout)
        controller.abort()
        ending.current = null

        if (mounted.current) {
          setId(null)
          setStatus('idle')
        }
      }
    })()

    return ending.current
  }, [finalize, closeConnection])

  const start = useCallback((): Promise<Session | null> => {
    if (ending.current) {
      return Promise.reject(
        new Error('Wait for the current session to finish closing.'),
      )
    }

    if (current.current) {
      return Promise.resolve(current.current)
    }

    if (pending.current) {
      if (pending.current.canceled) {
        return Promise.reject(
          new Error('The previous session is still closing. Please wait.'),
        )
      }

      return pending.current.result
    }

    const active = connection.current

    if (!active || active.signal.aborted) {
      return Promise.reject(new Error('Prepare the session connection first.'))
    }

    const { peer, channel, signal } = active
    setError(null)
    setStatus('connecting')
    failures.current = 0
    let timeout: ReturnType<typeof setTimeout> | undefined
    let finalized = false
    let canceled = false
    let disconnectTimeout: ReturnType<typeof setTimeout> | undefined
    const receive = ({ data: payload }: MessageEvent) => {
      let payloadJson: unknown

      try {
        payloadJson = JSON.parse(payload)
      } catch {
        setError('Invalid session event received.')
        setStatus('failed')
        return
      }

      const parsed = sessionEventSchema.safeParse(payloadJson)

      if (!parsed.success) {
        return
      }

      const event = parsed.data

      if (event.type === 'session.started') {
        clearTimeout(timeout)
        setStatus('connected')
      } else if (event.type === 'session.closed') {
        finalized = true
        clearTimeout(timeout)
        setStatus(event.reason === 'connection_lost' ? 'failed' : 'ended')

        if (event.reason === 'connection_lost') {
          setError('Voice connection was lost.')
        }
      } else if (event.type === 'error') {
        setError(
          'The voice provider reported an error. Try stopping and starting again.',
        )
      }
    }
    const closed = () => {
      if (finalized) {
        return
      }

      setError('Voice connection ended without confirmed finalization.')
      setStatus('failed')
    }
    const connectionChanged = () => {
      if (peer.connectionState === 'connected') {
        clearTimeout(disconnectTimeout)
        disconnectTimeout = undefined
      } else if (peer.connectionState === 'disconnected') {
        if (!disconnectTimeout) {
          disconnectTimeout = setTimeout(closed, 3000)
        }
      } else if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        closed()
      }
    }
    peer.addEventListener('connectionstatechange', connectionChanged)
    channel.addEventListener('message', receive)
    channel.addEventListener('close', closed)
    detach.current = () => {
      canceled = true

      if (pending.current) {
        pending.current.canceled = true
      }
      clearTimeout(timeout)
      clearTimeout(disconnectTimeout)
      peer.removeEventListener('connectionstatechange', connectionChanged)
      channel.removeEventListener('message', receive)
      channel.removeEventListener('close', closed)
    }

    const result = (async () => {
      await Promise.resolve()
      try {
        const offer = await peer.createOffer()

        if (signal.aborted) {
          return null
        }

        await peer.setLocalDescription(offer)
        await gatherIce(peer, signal)

        if (signal.aborted) {
          return null
        }

        const sdp = peer.localDescription?.sdp

        if (!sdp) {
          throw new Error('The session connection did not produce an offer.')
        }

        const session = await readJSON(
          await api({
            path: '/v1/voice/sessions',
            method: 'POST',
            body: { sdp },
          }),
          voiceAnswerSchema,
        )
        if (canceled && !ending.current) {
          // A timed-out Stop has already released media; still close its late API session.
          void finalize(session.id, AbortSignal.timeout(12_000)).catch(() => {})
          return null
        }

        current.current = session

        if (mounted.current && !canceled) {
          setId(session.id)
          timeout = setTimeout(() => {
            setError('Voice session did not connect. Please try again.')
            setStatus('failed')
          }, 15_000)
          await peer.setRemoteDescription({ type: 'answer', sdp: session.sdp })

          if (signal.aborted) {
            return null
          }
        }

        return canceled || !mounted.current ? null : session
      } catch (cause) {
        const abandoned = canceled
        detach.current?.()
        detach.current = null
        closeConnection()

        if (mounted.current && !abandoned) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Could not start the voice session.',
          )
          setStatus('failed')
        }

        if (abandoned) {
          return null
        }

        throw cause
      } finally {
        pending.current = null
      }
    })()

    pending.current = { result, canceled: false }
    return result
  }, [api, finalize, closeConnection])

  useEffect(() => {
    if (status === 'ended' || status === 'failed') {
      detach.current?.()
      detach.current = null
      closeConnection()
    }
  }, [status, closeConnection])

  const cleanup = useRef(end)
  cleanup.current = end

  useEffect(() => {
    mounted.current = true

    return () => {
      mounted.current = false
      void cleanup.current()
    }
  }, [])

  return {
    id,
    status,
    error: error ?? data?.error ?? null,
    prepare,
    start,
    end,
  }
}

/** Collect connection candidates before sending the offer; shutdown cancels the wait. */
function gatherIce(
  peer: RTCPeerConnection,
  signal: AbortSignal,
): Promise<void> {
  if (peer.iceGatheringState === 'complete' || signal.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', check)
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => {
      cleanup()
      resolve()
    }
    const check = () => {
      if (peer.iceGatheringState === 'complete') {
        cleanup()
        resolve()
      }
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Session connection setup timed out.'))
    }, 8000)
    peer.addEventListener('icegatheringstatechange', check)
    signal.addEventListener('abort', cancel, { once: true })
    check()
  })
}
