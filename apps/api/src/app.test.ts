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

  readonly voice = voiceFixture()
  readonly app = createApp({
    voice: this.voice.manager,
    location: this.voice.location,
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
      location: voiceFixture().location,
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
      location: voiceFixture().location,
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

test('location updates require authentication and valid coordinates', async () => {
  const { auth } = new AppFixture()
  const saved: unknown[] = []
  const app = createApp({
    voice: voiceFixture().manager,
    auth,
    location: {
      latest: async () => null,
      save: async (position) => {
        saved.push(position)
        return { ...position, recordedAt: new Date() }
      },
    },
    resources: {
      ping: async () => ({ healthy: true, details: {} }),
      close: async () => {},
    },
    allowedOrigin: 'http://localhost:5173',
    cookieSecure: false,
    isShuttingDown: () => false,
  })
  const body = JSON.stringify({
    latitude: 24.7,
    longitude: 46.7,
    accuracyMeters: 10,
  })
  const headers = {
    'content-type': 'application/json',
    origin: 'http://localhost:5173',
  }
  expect(
    (await app.request('/v1/location', { method: 'POST', headers, body }))
      .status,
  ).toBe(401)
  const login = await app.request('/v1/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: 'correct-password' }),
  })
  const access = (await login.json()) as { accessToken: string }
  const authorized = {
    ...headers,
    authorization: `Bearer ${access.accessToken}`,
  }
  expect(
    (
      await app.request('/v1/location', {
        method: 'POST',
        headers: authorized,
        body: JSON.stringify({
          latitude: 91,
          longitude: 46.7,
          accuracyMeters: 10,
        }),
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request('/v1/location', {
        method: 'POST',
        headers: authorized,
        body,
      })
    ).status,
  ).toBe(204)
  expect(saved).toEqual([
    { latitude: 24.7, longitude: 46.7, accuracyMeters: 10 },
  ])
})

test('voice UI stream delivers a location request and the answer resolves its tool', async () => {
  const fixture = voiceFixture()
  const auth = new AuthService({
    password: 'correct-password',
    signingSecret: '12345678901234567890123456789012',
    issuer: 'voice-agent',
    audience: 'voice-agent-api',
  })
  const app = createApp({
    voice: fixture.manager,
    location: fixture.location,
    auth,
    resources: {
      ping: async () => ({ healthy: true, details: {} }),
      close: async () => {},
    },
    allowedOrigin: 'http://localhost:5173',
    cookieSecure: false,
    isShuttingDown: () => false,
  })
  const { id } = await fixture.manager.create('offer')
  const token = (await auth.issueAccess()).accessToken
  const headers = { authorization: `Bearer ${token}` }
  const controller = new AbortController()
  const response = await app.request(`/v1/voice/sessions/${id}/ui-events`, {
    headers,
    signal: controller.signal,
  })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error('Missing event stream')
  }

  await reader.read()
  const pending = fixture.manager.uiEventChannel.requestLocation(id)
  const frame = new TextDecoder().decode((await reader.read()).value)
  const requestId = fixture.manager.uiEventChannel.requestId(id)
  expect(frame).toContain('location-request')

  if (!requestId) {
    throw new Error('Missing location request ID')
  }

  const reply = await app.request(
    `/v1/voice/sessions/${id}/location/${requestId}`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'granted',
        latitude: 24.7,
        longitude: 46.7,
        accuracyMeters: 12,
      }),
    },
  )
  expect(reply.status).toBe(204)
  expect(await pending).toMatchObject({ status: 'granted', latitude: 24.7 })
  expect(await fixture.location.latest()).toMatchObject({ latitude: 24.7 })
  await fixture.manager.end(id)
  expect((await reader.read()).done).toBe(true)
  controller.abort()
  await reader.cancel().catch(() => {})
})
