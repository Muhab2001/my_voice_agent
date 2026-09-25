import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AuthService } from '@voice/auth'
import type { RemoteResource } from '@voice/resource-manager'
import { cors } from 'hono/cors'
import { requestId, requireAllowedOrigin } from './http/middleware.js'
import {
  errorHandler,
  invalidRequestHook,
  notFoundHandler,
} from './http/responses.js'
import type { ApiEnv } from './http/types.js'
import {
  loginHandler,
  loginRoute,
  logoutHandler,
  logoutRoute,
  refreshHandler,
  refreshRoute,
} from './routes/auth.js'
import {
  liveHandler,
  liveRoute,
  readyHandler,
  readyRoute,
} from './routes/health.js'

export type ApiDependencies = {
  auth: AuthService
  resources: RemoteResource<Record<string, string>>
  allowedOrigin: string
  cookieSecure: boolean
  isShuttingDown: () => boolean
}

export function createApp({
  auth,
  resources,
  allowedOrigin,
  cookieSecure,
  isShuttingDown,
}: ApiDependencies) {
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: invalidRequestHook })

  app.use('*', requestId)
  app.use(
    '*',
    cors({
      origin: allowedOrigin,
      credentials: true,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  )
  app.use('/v1/auth/*', requireAllowedOrigin(allowedOrigin))
  app.onError(errorHandler)
  app.notFound(notFoundHandler)

  app.openapi(liveRoute, liveHandler)
  app.openapi(readyRoute, readyHandler(resources, isShuttingDown))
  app.openapi(loginRoute, loginHandler(auth, { secure: cookieSecure }))
  app.openapi(refreshRoute, refreshHandler(auth))
  app.openapi(logoutRoute, logoutHandler({ secure: cookieSecure }))

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Voice Agent API', version: '0.1.0' },
  })
  app.get('/docs', swaggerUI({ url: '/openapi.json' }))
  return app
}
