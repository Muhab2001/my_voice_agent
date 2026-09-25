import { AuthService } from '@voice/auth'
import { createApp } from '../app.js'
import { type ServerState, startApiServer } from '../server.js'

const resources = {
  ping: async () => ({ healthy: true, details: {} }),
  close: async () => {},
}
const state: ServerState = { shuttingDown: false }
const auth = new AuthService({
  password: 'correct-password',
  signingSecret: '12345678901234567890123456789012',
  issuer: 'voice-agent',
  audience: 'voice-agent-api',
})
const app = createApp({
  auth,
  resources,
  allowedOrigin: 'http://localhost:5173',
  cookieSecure: false,
  isShuttingDown: () => state.shuttingDown,
})

startApiServer(app, resources, Number(process.env.PORT), state)
