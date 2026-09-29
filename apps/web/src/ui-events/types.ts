import type { placeCardSchema, voiceUiEventSchema } from '@voice/contracts'
import type { z } from 'zod'

export type VoiceUiEvent = z.infer<typeof voiceUiEventSchema>
export type PlaceCard = z.infer<typeof placeCardSchema>
export type ReservationOptions = Pick<
  Extract<VoiceUiEvent, { type: 'reservation-options' }>,
  'kind' | 'options'
>
