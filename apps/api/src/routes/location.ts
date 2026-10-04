import type { LocationStore } from '@voice/database'
import { z } from 'zod'
import { errorResponse, jsonResponse } from '../http/responses.js'
import { route } from '../http/route.js'

// Saves the browser's latest position for nearby place searches.
export const saveLocationRoute = (location: LocationStore) =>
  route(
    {
      method: 'post',
      path: '/v1/location',
      request: {
        body: {
          ...jsonResponse(
            z.object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
              accuracyMeters: z.number().min(0).max(100_000),
            }),
          ),
          required: true,
        },
      },
      responses: {
        204: { description: 'Position saved' },
        400: errorResponse,
        401: errorResponse,
      },
    },
    async (c) => {
      await location.save(c.req.valid('json'))
      return c.body(null, 204)
    },
  )
