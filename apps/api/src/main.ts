import { AuthService } from '@voice/auth'
import { NewRedisCache } from '@voice/cache'
import {
  DrizzleMemoryService,
  DrizzleTranscriptService,
  DrizzleVoiceSessionService,
  newDrizzleDatabase,
} from '@voice/database'
import { ResourceManager } from '@voice/resource-manager'
import { createApp } from './app.js'
import { loadEnv } from './env.js'
import { type ServerState, startApiServer } from './server.js'
import { GPTLiveVoiceChatProvider } from './voice/provider.js'
import { VoiceSessionManager } from './voice/session-manager.js'

const env = loadEnv()
const database = newDrizzleDatabase({
  url: env.DATABASE_URL,
  poolMax: env.DATABASE_POOL_MAX,
  poolMin: env.DATABASE_POOL_MIN,
  idleTimeoutMs: env.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMs: env.DATABASE_CONNECTION_TIMEOUT_MS,
  queryTimeoutMs: env.DATABASE_QUERY_TIMEOUT_MS,
  maxLifetimeSeconds: env.DATABASE_MAX_LIFETIME_SECONDS,
})
const redis = NewRedisCache({
  url: env.REDIS_URL,
  connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
  pingTimeoutMs: env.REDIS_PING_TIMEOUT_MS,
  disableOfflineQueue: env.REDIS_DISABLE_OFFLINE_QUEUE === 'true',
  reconnectDelayMs: env.REDIS_RECONNECT_DELAY_MS,
})
const resources = new ResourceManager({
  database: database.resource,
  redis: redis.resource,
})

const startupReport = await resources.ping()
if (!startupReport.healthy) {
  await resources
    .close()
    .catch((closeError) => console.error('Startup cleanup failed', closeError))
  throw new Error(
    `Required resources are unavailable: ${JSON.stringify(startupReport.details)}`,
  )
}

try {
  const auth = new AuthService({
    password: env.APP_PASSWORD,
    signingSecret: env.JWT_SIGNING_SECRET,
    issuer: 'voice-agent',
    audience: 'voice-agent-api',
  })

  const state: ServerState = { shuttingDown: false }
  const voice = new VoiceSessionManager(
    new DrizzleVoiceSessionService(database.client),
    new DrizzleMemoryService(database.client),
    new DrizzleTranscriptService(database.client),
    new GPTLiveVoiceChatProvider(env.OPENAI_API_KEY),
  )
  const app = createApp({
    voice,
    auth,
    resources,
    allowedOrigin: env.ALLOWED_ORIGIN,
    cookieSecure: env.COOKIE_SECURE === 'true',
    isShuttingDown: () => state.shuttingDown,
  })

  startApiServer(app, resources, env.PORT, state, voice)
} catch (error) {
  await resources
    .close()
    .catch((closeError) => console.error('Startup cleanup failed', closeError))
  throw error
}
