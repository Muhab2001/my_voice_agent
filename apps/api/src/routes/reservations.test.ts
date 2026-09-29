import { expect, test } from 'bun:test'
import { AuthService } from '@voice/auth'
import {
  ReservationError,
  type ReservationService,
  type ReservationState,
} from '@voice/database'
import { createApp } from '../app.js'
import { voiceFixture } from '../testing/voice-fixture.js'

const id = crypto.randomUUID()
const state: ReservationState = {
  id,
  status: 'draft',
  hotelId: crypto.randomUUID(),
  hotel: 'Marriott - Riyadh',
  city: 'Riyadh',
  brand: 'Marriott',
  stayDate: '2026-10-02',
  guestName: 'Amina',
  rooms: [
    {
      offeringId: crypto.randomUUID(),
      name: 'King Room',
      quantity: 1,
      unitPriceSar: 420,
      lineTotalSar: 420,
    },
  ],
  quotedTotalSar: 420,
  confirmedTotalSar: null,
  nextMissingField: null,
  reason: null,
  revision: 2,
  updatedAt: new Date().toISOString(),
}

class ConfirmationService implements ReservationService {
  current = state
  async hotels() {
    return []
  }
  async offerings() {
    return []
  }
  async create(): Promise<ReservationState> {
    throw new Error('Unexpected browser write')
  }
  async get(key: string) {
    return key === id ? this.current : null
  }
  async active() {
    return this.current
  }
  async list() {
    return []
  }
  async update(): Promise<ReservationState> {
    throw new Error('Unexpected browser write')
  }
  async confirm(key: string, revision: number) {
    if (key !== id) {
      throw new ReservationError('not_found', 'Reservation not found')
    }
    if (revision !== this.current.revision) {
      throw new ReservationError('conflict', 'Reservation changed')
    }
    this.current = {
      ...this.current,
      status: 'confirmed' as const,
      confirmedTotalSar: 420,
      revision: revision + 1,
    }
    return this.current
  }
  async abandon(): Promise<ReservationState> {
    throw new Error('Unexpected browser write')
  }
  async resume(): Promise<ReservationState> {
    throw new Error('Unexpected browser write')
  }
}

test('browser can read and confirm, but cannot create or edit reservations over HTTP', async () => {
  const auth = new AuthService({
    password: 'correct-password',
    signingSecret: '12345678901234567890123456789012',
    issuer: 'voice-agent',
    audience: 'voice-agent-api',
  })
  const voice = voiceFixture()
  const reservations = new ConfirmationService()
  const app = createApp({
    auth,
    voice: voice.manager,
    location: voice.location,
    reservations,
    resources: {
      ping: async () => ({ healthy: true, details: {} }),
      close: async () => {},
    },
    allowedOrigin: 'http://localhost:5173',
    cookieSecure: false,
    isShuttingDown: () => false,
  })
  const token = (await auth.issueAccess()).accessToken
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  }
  expect((await app.request('/v1/reservations/active')).status).toBe(401)
  expect(
    (await app.request('/v1/reservations/active', { headers })).status,
  ).toBe(200)
  expect(
    (
      await app.request('/v1/reservations', {
        method: 'POST',
        headers,
        body: '{}',
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await app.request(`/v1/reservations/${id}`, {
        method: 'POST',
        headers,
        body: '{}',
      })
    ).status,
  ).toBe(404)
  expect(
    (
      await app.request(`/v1/reservations/${id}/confirm`, {
        method: 'POST',
        headers,
        body: '{}',
      })
    ).status,
  ).toBe(400)
  const stale = await app.request(`/v1/reservations/${id}/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ revision: 1 }),
  })
  expect(stale.status).toBe(409)
  expect(
    ((await stale.json()) as { latest: ReservationState }).latest.revision,
  ).toBe(2)
  const confirmed = await app.request(`/v1/reservations/${id}/confirm`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ revision: 2 }),
  })
  expect(confirmed.status).toBe(200)
  expect(((await confirmed.json()) as ReservationState).status).toBe(
    'confirmed',
  )
})
