import type { RemoteResource } from '@voice/resource-manager'
import { z } from 'zod'
import { jsonResponse } from '../http/responses.js'
import { route } from '../http/route.js'

// Reports whether the API process is running.
export const liveRoute = route(
  {
    method: 'get',
    path: '/health/live',
    responses: {
      200: jsonResponse(
        z
          .object({ status: z.enum(['ok', 'unavailable']) })
          .openapi('HealthResponse'),
      ),
    },
  },
  (c) => c.json({ status: 'ok' as const }, 200),
)

// Reports whether dependencies are healthy and the API accepts new work.
export const readyRoute = (
  resources: RemoteResource<Record<string, string>>,
  isShuttingDown: () => boolean,
) => {
  const response = jsonResponse(
    z
      .object({
        status: z.enum(['ok', 'unavailable']),
        resources: z.record(z.string()),
      })
      .openapi('ReadinessResponse'),
  )

  return route(
    {
      method: 'get',
      path: '/health/ready',
      responses: {
        200: response,
        503: response,
      },
    },
    async (c) => {
      if (isShuttingDown()) {
        return c.json({ status: 'unavailable' as const, resources: {} }, 503)
      }

      const report = await resources.ping()

      if (!report.healthy) {
        return c.json(
          { status: 'unavailable' as const, resources: report.details },
          503,
        )
      }

      return c.json({ status: 'ok' as const, resources: report.details }, 200)
    },
  )
}
