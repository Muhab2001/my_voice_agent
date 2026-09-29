import { expect, test } from 'bun:test'
import { AuthService } from '@voice/auth'
import { createApp } from '../app.js'
import {
  TestReservationService,
  voiceFixture,
} from '../testing/voice-fixture.js'

test('voice routes authenticate, validate, expose local transcripts and reject creation while draining', async () => {
  const { manager, socket, location } = voiceFixture()
  const auth = new AuthService({
    password: 'correct-password',
    signingSecret: '12345678901234567890123456789012',
    issuer: 'voice-agent',
    audience: 'voice-agent-api',
  })
  let draining = false
  const app = createApp({
    auth,
    voice: manager,
    location,
    reservations: new TestReservationService(),
    resources: {
      ping: async () => ({ healthy: true, details: {} }),
      close: async () => {},
    },
    allowedOrigin: 'http://localhost:5173',
    cookieSecure: false,
    isShuttingDown: () => draining,
  })
  const path = '/v1/voice/sessions'
  const request = (headers: Record<string, string>, body = { sdp: 'offer' }) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  expect((await request({})).status).toBe(401)
  const token = (await auth.issueAccess()).accessToken
  const headers = { authorization: `Bearer ${token}` }
  expect(
    (await request({ authorization: `Bearer ${await auth.issueRefresh()}` }))
      .status,
  ).toBe(401)
  expect(
    (await request({ ...headers, origin: 'https://foreign.example' })).status,
  ).toBe(403)
  expect((await request(headers, { sdp: '' })).status).toBe(400)
  const created = await request(headers)
  expect(created.status).toBe(201)
  const { id, sdp } = (await created.json()) as { id: string; sdp: string }
  expect(sdp).toBe('answer')
  expect(id).not.toBe('live-test')
  socket.event({
    type: 'session.output_transcript.delta',
    delta: 'Hi!',
    start_ms: 0,
    end_ms: 100,
  })
  expect((await app.request(`${path}/${id}`, { headers })).status).toBe(200)
  expect(
    (await app.request(`${path}/${id}/end`, { method: 'POST', headers }))
      .status,
  ).toBe(204)
  expect(
    (await app.request(`${path}/${id}/end`, { method: 'POST', headers }))
      .status,
  ).toBe(204)
  const snapshots = await app.request(`${path}/${id}/transcripts`, { headers })
  expect(
    ((await snapshots.json()) as { snapshots: { text: string }[] }).snapshots[0]
      .text,
  ).toBe('Hi!')
  expect(
    (await app.request(`${path}/${crypto.randomUUID()}`, { headers })).status,
  ).toBe(404)
  draining = true
  expect((await request(headers)).status).toBe(503)
})
