import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import { healthSchema, readinessSchema } from '@voice/contracts'
import type { RemoteResource } from '@voice/resource-manager'
import type { ApiEnv } from '../app.js'
import { jsonResponse } from '../http/responses.js'

export const liveRoute = createRoute({
  method: 'get',
  path: '/health/live',
  responses: { 200: jsonResponse(healthSchema) },
})

export const readyRoute = createRoute({
  method: 'get',
  path: '/health/ready',
  responses: {
    200: jsonResponse(readinessSchema),
    503: jsonResponse(readinessSchema),
  },
})

export const liveHandler: RouteHandler<typeof liveRoute, ApiEnv> = (c) =>
  c.json({ status: 'ok' as const }, 200)

export const readyHandler =
  (
    resources: RemoteResource<Record<string, string>>,
    isShuttingDown: () => boolean,
  ): RouteHandler<typeof readyRoute, ApiEnv> =>
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
  }
