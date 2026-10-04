import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AuthService } from '@voice/auth'
import type { LocationStore, ReservationStore } from '@voice/database'
import type { RemoteResource } from '@voice/resource-manager'
import { cors } from 'hono/cors'
import { AllowedOrigin, Authenticated, requestId } from './http/middleware.js'
import {
  internalErrHandler,
  invalidRequestHook,
  notFoundHandler,
} from './http/responses.js'
import { addRoute } from './http/route.js'
import { loginRoute, logoutRoute, refreshRoute } from './routes/auth.js'
import { liveRoute, readyRoute } from './routes/health.js'
import { saveLocationRoute } from './routes/location.js'
import { confirmReservationRoute } from './routes/reservations.js'
import { streamUiEventsRoute } from './routes/ui-events.js'
import {
  createVoiceSessionRoute,
  endVoiceSessionRoute,
  getVoiceSessionRoute,
} from './routes/voice.js'
import type { VoiceSessionManager } from './voice/session-manager.js'

export type ApiEnv = {
  Variables: {
    requestId: string
  }
}

type ApiDependencies = {
  voice: VoiceSessionManager
  location: LocationStore
  reservations: ReservationStore
  auth: AuthService
  resources: RemoteResource<Record<string, string>>
  allowedOrigin: string
  cookieSecure: boolean
  isShuttingDown: () => boolean
}

export function createApp({
  auth,
  voice,
  location,
  reservations,
  resources,
  allowedOrigin,
  cookieSecure,
  isShuttingDown,
}: ApiDependencies) {
  if (!voice) {
    throw new Error('Voice session manager is required')
  }

  if (!reservations) {
    throw new Error('Reservation service is required')
  }

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
  app.use('/v1/auth/*', AllowedOrigin(allowedOrigin))
  app.use('/v1/voice/*', AllowedOrigin(allowedOrigin))
  app.use('/v1/voice/*', Authenticated(auth))
  app.use('/v1/location', AllowedOrigin(allowedOrigin))
  app.use('/v1/location', Authenticated(auth))
  app.use('/v1/reservations*', AllowedOrigin(allowedOrigin))
  app.use('/v1/reservations*', Authenticated(auth))
  app.onError(internalErrHandler)
  app.notFound(notFoundHandler)

  addRoute(app, liveRoute)
  addRoute(app, readyRoute(resources, isShuttingDown))
  addRoute(app, loginRoute(auth, { secure: cookieSecure }))
  addRoute(app, refreshRoute(auth))
  addRoute(app, logoutRoute({ secure: cookieSecure }))

  addRoute(app, createVoiceSessionRoute(voice, isShuttingDown))
  addRoute(app, endVoiceSessionRoute(voice))
  addRoute(app, getVoiceSessionRoute(voice))
  addRoute(app, streamUiEventsRoute(voice))

  addRoute(app, saveLocationRoute(location))
  addRoute(app, confirmReservationRoute(reservations))

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Voice Agent API', version: '0.1.0' },
  })
  app.get('/docs', swaggerUI({ url: '/openapi.json' }))
  return app
}
