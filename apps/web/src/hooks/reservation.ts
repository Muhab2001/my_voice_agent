import { reservationStateSchema } from '@voice/contracts'
import { useEffect, useState } from 'react'
import useSWRMutation from 'swr/mutation'
import { z } from 'zod'
import { ApiError, readJSON, useApi } from './api'

type State = z.infer<typeof reservationStateSchema>

export const confirmationSchema = z.object({
  id: z.string().uuid('This reservation has an invalid ID.'),
  revision: z
    .number()
    .int()
    .positive('This reservation has an invalid revision.'),
  status: z.literal('draft', {
    errorMap: () => ({ message: 'Only a draft reservation can be confirmed.' }),
  }),
  hotelId: z
    .string({ invalid_type_error: 'Choose a hotel before confirming.' })
    .uuid('Choose a valid hotel before confirming.'),
  stayDate: z
    .string({ invalid_type_error: 'Choose a stay date before confirming.' })
    .date('Choose a valid stay date before confirming.'),
  guestName: z
    .string({ invalid_type_error: 'Enter a guest name before confirming.' })
    .trim()
    .min(1, 'Enter a guest name before confirming.'),
  rooms: z
    .array(
      z.object({
        offeringId: z.string().uuid('Choose a valid room before confirming.'),
        quantity: z
          .number()
          .int('Room quantities must be whole numbers.')
          .min(1, 'Choose at least one of each room.')
          .max(100, 'Choose at most 100 of each room.'),
      }),
    )
    .min(1, 'Choose at least one room before confirming.'),
  quotedTotalSar: z
    .number({
      invalid_type_error: 'A price quote is required before confirming.',
    })
    .nonnegative('The price quote must not be negative.'),
})

/** Holds one tool-provided reservation and only sends explicit confirmation. */
export function useReservation(snapshot: State) {
  const api = useApi()
  const [state, setState] = useState(snapshot)

  useEffect(() => {
    setState((current) =>
      current.id === snapshot.id && current.revision > snapshot.revision
        ? current
        : snapshot,
    )
  }, [snapshot])

  const { trigger, isMutating, error } = useSWRMutation(
    `/v1/reservations/${state.id}/confirm`,
    async (_key: string, { arg }: { arg: State }) => {
      const parsed = confirmationSchema.safeParse(arg)

      if (!parsed.success) {
        throw new Error(
          parsed.error.issues.map((issue) => issue.message).join(' '),
        )
      }

      try {
        const next = await readJSON(
          await api({
            path: `/v1/reservations/${parsed.data.id}/confirm`,
            method: 'POST',
            body: { revision: parsed.data.revision },
          }),
          reservationStateSchema,
        )
        setState((current) =>
          current.revision > next.revision ? current : next,
        )
        return next
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 409) {
          const conflict = z
            .object({ latest: reservationStateSchema })
            .safeParse(cause.body)

          if (conflict.success) {
            const next = conflict.data.latest
            setState((current) =>
              current.revision > next.revision ? current : next,
            )
          }
        }

        throw cause
      }
    },
    { revalidate: false },
  )

  return {
    state,
    setState,
    confirm: () => trigger(state),
    isMutating,
    error: error instanceof Error ? error.message : null,
  }
}
