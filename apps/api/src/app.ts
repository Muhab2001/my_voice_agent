import { swaggerUI } from '@hono/swagger-ui'
import { OpenAPIHono } from '@hono/zod-openapi'
import type { AuthService } from '@voice/auth'
import type { LocationService } from '@voice/database'
import type { RemoteResource } from '@voice/resource-manager'
import { cors } from 'hono/cors'
import { AllowedOrigin, Authenticated, requestId } from './http/middleware.js'
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
import {
  locationToolReplyHandler,
  locationToolReplyRoute,
  saveLocationHandler,
  saveLocationRoute,
} from './routes/location.js'
import {
  createVoiceHandler,
  createVoiceRoute,
  endVoiceHandler,
  endVoiceRoute,
  transcriptsHandler,
  transcriptsRoute,
  voiceStatusHandler,
  voiceStatusRoute,
} from './routes/voice.js'
import { voiceUiEventsHandler } from './routes/voice-ui-events.js'
import type { VoiceSessionManager } from './voice/session-manager.js'

export type ApiDependencies = {
  voice: VoiceSessionManager
  location: LocationService
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
  resources,
  allowedOrigin,
  cookieSecure,
  isShuttingDown,
}: ApiDependencies) {
  if (!voice) {
    throw new Error('Voice session manager is required')
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
  app.onError(errorHandler)
  app.notFound(notFoundHandler)

  app.openapi(liveRoute, liveHandler)
  app.openapi(readyRoute, readyHandler(resources, isShuttingDown))
  app.openapi(loginRoute, loginHandler(auth, { secure: cookieSecure }))
  app.openapi(refreshRoute, refreshHandler(auth))
  app.openapi(logoutRoute, logoutHandler({ secure: cookieSecure }))

  app.openapi(createVoiceRoute, createVoiceHandler(voice, isShuttingDown))
  app.openapi(endVoiceRoute, endVoiceHandler(voice))
  app.openapi(voiceStatusRoute, voiceStatusHandler(voice))
  app.openapi(transcriptsRoute, transcriptsHandler(voice))

  app.openapi(saveLocationRoute, saveLocationHandler(location))
  app.openapi(locationToolReplyRoute, locationToolReplyHandler(voice, location))
  app.get('/v1/voice/sessions/:id/ui-events', voiceUiEventsHandler(voice))

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Voice Agent API', version: '0.1.0' },
  })
  app.get('/docs', swaggerUI({ url: '/openapi.json' }))
  return app
}
