import { errorSchema, reservationStateSchema } from '@voice/contracts'
import { ReservationError, type ReservationStore } from '@voice/database'
import { z } from 'zod'
import { errorResponse, fail, jsonResponse } from '../http/responses.js'
import { route } from '../http/route.js'

// Confirms the current reservation revision selected in the browser.
export const confirmReservationRoute = (reservations: ReservationStore) =>
  route(
    {
      method: 'post',
      path: '/v1/reservations/{id}/confirm',
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          ...jsonResponse(
            z.object({ revision: z.number().int().positive() }).strict(),
          ),
          required: true,
        },
      },
      responses: {
        200: jsonResponse(reservationStateSchema),
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
        409: jsonResponse(
          errorSchema.extend({ latest: reservationStateSchema.nullable() }),
        ),
      },
    },
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
    },
  )
