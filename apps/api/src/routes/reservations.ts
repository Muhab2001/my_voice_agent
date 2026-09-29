import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  errorSchema,
  reservationActionSchema,
  reservationStateSchema,
} from '@voice/contracts'
import { ReservationError, type ReservationService } from '@voice/database'
import { z } from 'zod'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import type { ApiEnv } from '../http/types.js'

const reservationIdSchema = z.object({ id: z.string().uuid() })
const conflictResponse = jsonResponse(
  errorSchema.extend({ latest: reservationStateSchema.nullable() }),
)

export const activeReservationRoute = createRoute({
  method: 'get',
  path: '/v1/reservations/active',
  responses: {
    200: jsonResponse(reservationStateSchema.nullable()),
    401: errorResponse,
  },
})

export const confirmReservationRoute = createRoute({
  method: 'post',
  path: '/v1/reservations/{id}/confirm',
  request: {
    params: reservationIdSchema,
    body: { ...jsonResponse(reservationActionSchema), required: true },
  },
  responses: {
    200: jsonResponse(reservationStateSchema),
    400: errorResponse,
    401: errorResponse,
    404: errorResponse,
    409: conflictResponse,
  },
})

export const activeReservationHandler =
  (
    reservations: ReservationService,
  ): RouteHandler<typeof activeReservationRoute, ApiEnv> =>
  async (c) =>
    c.json(await reservations.active(), 200)

export const confirmReservationHandler =
  (
    reservations: ReservationService,
  ): RouteHandler<typeof confirmReservationRoute, ApiEnv> =>
  async (c) => {
    const { id } = c.req.valid('param')
    const { revision } = c.req.valid('json')

    try {
      return c.json(await reservations.confirm(id, revision), 200)
    } catch (error) {
      if (!(error instanceof ReservationError)) {
        throw error
      }

      if (error.code === 'conflict') {
        return c.json(
          {
            error: {
              code: error.code,
              message: error.message,
              requestId: c.get('requestId'),
            },
            latest: await reservations.get(id),
          },
          409,
        )
      }

      return error.code === 'not_found'
        ? fail(c, 404, error.code, error.message)
        : fail(c, 400, error.code, error.message)
    }
  }
