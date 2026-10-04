import { AuthService } from '@voice/auth'
import { ResourceManager } from '@voice/resource-manager'
import { createApp } from '../app.js'
import { type ServerState, startApiServer } from '../server.js'
import { functionCall, voiceFixture } from './voice-fixture.js'

const voice = voiceFixture()
if (process.env.VOICE_SHUTDOWN === 'true') {
  const { id } = await voice.manager.create('offer')
  voice.memory.beforeWrite = async () => {
    await Bun.sleep(150)
  }
  voice.socket.event({
    type: 'session.input_transcript.delta',
    delta: 'I prefer tea',
    start_ms: 0,
    end_ms: 100,
  })
  functionCall(voice.socket)
  voice.socket.response({
    type: 'response.completed',
    response: { id: 'response-pending' },
  })
  console.log(`Voice session ready: ${id}`)
}

const resources = new ResourceManager({
  database: {
    ping: async () => ({ healthy: true, details: 'Test database is ready' }),
    close: async () => {
      if (process.env.STALL_RESOURCE === 'true') {
        await new Promise<void>(() => {})
      }

      if (process.env.VOICE_SHUTDOWN === 'true') {
        console.log(
          `Closed resources after memory=${voice.memory.facts.length} transcript=${voice.transcripts.chunks.size} finalization=${[...voice.sessions.rows.values()][0].finalization}`,
        )
      }
    },
  },
  voice: voice.manager,
})
const state: ServerState = { shuttingDown: false }
const auth = new AuthService({
  password: 'correct-password',
  signingSecret: '12345678901234567890123456789012',
  issuer: 'voice-agent',
  audience: 'voice-agent-api',
})
const app = createApp({
  voice: voice.manager,
  location: voice.location,
  reservations: voice.reservations,
  auth,
  resources,
  allowedOrigin: 'http://localhost:5173',
  cookieSecure: false,
  isShuttingDown: () => state.shuttingDown,
})

startApiServer(app, resources, Number(process.env.PORT), state, voice.manager)
