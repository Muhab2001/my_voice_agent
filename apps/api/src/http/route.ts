import {
  createRoute,
  type OpenAPIHono,
  type RouteConfig,
  type RouteHandler,
} from '@hono/zod-openapi'
import type { ApiEnv } from '../app.js'

const routeDefinition = Symbol('route')

export function route<R extends RouteConfig>(
  schema: R,
  handler: RouteHandler<NoInfer<R>, ApiEnv>,
) {
  return {
    schema: createRoute(schema),
    handler,
    [routeDefinition]: true as const,
  }
}

export function addRoute(
  app: OpenAPIHono<ApiEnv>,
  definition: {
    schema: RouteConfig
    handler: unknown
    [routeDefinition]: true
  },
) {
  // route() checks that the handler matches its schema before registration.
  app.openapi(definition.schema as never, definition.handler as never)
}
