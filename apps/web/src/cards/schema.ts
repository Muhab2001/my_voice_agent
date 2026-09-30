import {
  dateOptionSchema,
  hotelOptionSchema,
  offeringOptionSchema,
  placeCardSchema,
  reservationStateSchema,
} from '@voice/contracts'
import { z } from 'zod'

const messageSchema = z.object({ message: z.string() })

export const suggestionsCardSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('hotels'),
    options: z.union([z.array(hotelOptionSchema), messageSchema]),
  }),
  z.object({
    kind: z.literal('rooms'),
    options: z.union([z.array(offeringOptionSchema), messageSchema]),
  }),
  z.object({
    kind: z.literal('dates'),
    options: z.union([z.array(dateOptionSchema), messageSchema]),
  }),
  z.object({
    kind: z.literal('reservations'),
    options: z.union([z.array(reservationStateSchema), messageSchema]),
  }),
])

/** Every renderable card has a stable identity and a typed payload. */
export const floatingCardSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    type: z.literal('places'),
    places: placeCardSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('reservation'),
    reservation: reservationStateSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal('suggestions'),
    suggestions: suggestionsCardSchema,
  }),
])

export type FloatingCardData = z.infer<typeof floatingCardSchema>
export type SuggestionsCardData = z.infer<typeof suggestionsCardSchema>
