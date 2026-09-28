import { describe, expect, test } from 'bun:test'
import { AuthService } from '@voice/auth'
import { createApp } from './app.js'
import { voiceFixture } from './testing/voice-fixture.js'
import type { VoiceSessionManager } from './voice/session-manager.js'

class AppFixture {
  private ready = true
  private shuttingDown = false

  readonly auth = new AuthService({
    password: 'correct-password',
    signingSecret: '12345678901234567890123456789012',
    issuer: 'voice-agent',
    audience: 'voice-agent-api',
  })

  readonly app = createApp({
    voice: voiceFixture().manager,
    auth: this.auth,
    resources: {
      ping: async () => ({
        healthy: this.ready,
        details: {
          database: this.ready ? 'PostgreSQL is reachable' : 'offline',
        },
      }),
      close: async () => {},
    },
    allowedOrigin: 'http://localhost:5173',
    cookieSecure: false,
    isShuttingDown: () => this.shuttingDown,
  })

  readonly setReady = (value: boolean) => {
    this.ready = value
  }

  readonly setShuttingDown = (value: boolean) => {
    this.shuttingDown = value
  }
}

describe('phase 1 API', () => {
  test('liveness, readiness, and generated OpenAPI', async () => {
    const { app, setReady, setShuttingDown } = new AppFixture()
    expect((await app.request('/health/live')).status).toBe(200)
    const ready = await app.request('/health/ready')
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({
      status: 'ok',
      resources: { database: 'PostgreSQL is reachable' },
    })
    setReady(false)
    const unavailable = await app.request('/health/ready')
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({
      status: 'unavailable',
      resources: { database: 'offline' },
    })
    expect((await app.request('/health/live')).status).toBe(200)
    setReady(true)
    setShuttingDown(true)
    expect((await app.request('/health/ready')).status).toBe(503)
    const doc = (await (await app.request('/openapi.json')).json()) as {
      paths: Record<string, unknown>
    }
    expect(doc.paths['/v1/auth/login']).toBeDefined()
    expect(doc.paths['/v1/auth/refresh']).toBeDefined()
  })

  test('login, refresh, logout, and token types', async () => {
    const { app, auth } = new AppFixture()
    const bad = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    })
    expect(bad.status).toBe(401)
    const login = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' }),
    })
    expect(login.status).toBe(200)
    const access = (await login.json()) as {
      accessToken: string
      expiresAt: string
    }
    await auth.verifyAccess(access.accessToken)
    await expect(auth.verifyRefresh(access.accessToken)).rejects.toThrow()
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    expect(cookie).toStartWith('voice_refresh=')
    if (!cookie) {
      throw new Error('Login did not set a refresh cookie')
    }
    const refresh = await app.request('/v1/auth/refresh', {
      method: 'POST',
      headers: { cookie },
    })
    expect(refresh.status).toBe(200)
    expect(refresh.headers.get('set-cookie')).toBeNull()
    const newAccess = (await refresh.json()) as { accessToken: string }
    await auth.verifyAccess(newAccess.accessToken)
    expect(
      (
        await app.request('/v1/auth/refresh', {
          method: 'POST',
          headers: { cookie: `voice_refresh=${access.accessToken}` },
        })
      ).status,
    ).toBe(401)
    const logout = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { cookie },
    })
    expect(logout.status).toBe(204)
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  test('production cookies work across sites and foreign origins are rejected', async () => {
    const auth = new AuthService({
      password: 'correct-password',
      signingSecret: '12345678901234567890123456789012',
      issuer: 'voice-agent',
      audience: 'voice-agent-api',
    })
    const app = createApp({
      voice: voiceFixture().manager,
      auth,
      resources: {
        ping: async () => ({ healthy: true, details: {} }),
        close: async () => {},
      },
      allowedOrigin: 'https://voice.vercel.app',
      cookieSecure: true,
      isShuttingDown: () => false,
    })
    const login = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://voice.vercel.app',
      },
      body: JSON.stringify({ password: 'correct-password' }),
    })
    expect(login.status).toBe(200)
    expect(login.headers.get('set-cookie')).toContain('SameSite=None')
    expect(login.headers.get('set-cookie')).toContain('Secure')
    const foreign = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://example.com' },
    })
    expect(foreign.status).toBe(403)
  })

  test('invalid body receives a structured error', async () => {
    const { app } = new AppFixture()
    const response = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as {
      error: { code: string; requestId: string }
    }
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.requestId).toBe(
      response.headers.get('X-Request-Id') ?? '',
    )
  })
})

test('missing voice runtime fails app construction rather than serving a partial API', () => {
  const { auth } = new AppFixture()
  expect(() =>
    createApp({
      auth,
      voice: undefined as unknown as VoiceSessionManager,
      resources: {
        ping: async () => ({ healthy: true, details: {} }),
        close: async () => {},
      },
      allowedOrigin: 'http://localhost:5173',
      cookieSecure: false,
      isShuttingDown: () => false,
    }),
  ).toThrow('Voice session manager is required')
})
