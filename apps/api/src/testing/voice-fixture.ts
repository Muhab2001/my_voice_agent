import type {
  Coordinates,
  HotelOption,
  LocationStore,
  Memory,
  MemoryInput,
  MemoryQuery,
  MemoryStore,
  OfferingOption,
  ReservationPatch,
  ReservationState,
  ReservationStore,
  SavedLocation,
  SessionUpdate,
  Snapshot,
  TranscriptStore,
  VoiceSessionStore,
} from '@voice/database'
import type { PlacesService } from '../voice/places.js'
import type { SidebandSocket, VoiceChatProvider } from '../voice/provider.js'
import {
  VoiceSessionManager,
  type VoiceSessionManagerOptions,
} from '../voice/session-manager.js'

export class TestSocket extends EventTarget implements SidebandSocket {
  readyState = 0
  sent: Record<string, unknown>[] = []
  autoFinalize = true
  autoContinue = true
  continuation = 0

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  event(event: Record<string, unknown>) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({ event_id: crypto.randomUUID(), ...event }),
      }),
    )
  }

  response(event: Record<string, unknown>, delegationId = 'delegation-1') {
    this.event({ type: 'response.event', delegation_id: delegationId, event })
  }

  send(data: string) {
    const event = JSON.parse(data) as Record<string, unknown>
    this.sent.push(event)
    if (event.type === 'session.close' && this.autoFinalize) {
      this.event({
        type: 'session.closed',
        reason: 'close_requested',
        usage: { seconds: 4 },
      })
    }
    if (event.type === 'response.create' && this.autoContinue) {
      queueMicrotask(() =>
        this.response({
          type: 'response.completed',
          response: {
            id: `continued-${++this.continuation}`,
            usage: { output_tokens: 5 },
          },
        }),
      )
    }
  }

  close() {
    if (this.readyState === 3) {
      return
    }
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

/** In-memory local session records for lifecycle tests. */
export class TestVoiceSessionService implements VoiceSessionStore {
  rows = new Map<
    string,
    NonNullable<Awaited<ReturnType<VoiceSessionStore['get']>>>
  >()

  async create() {
    const id = crypto.randomUUID()
    this.rows.set(id, {
      id,
      vendorSessionId: null,
      vendor: 'openai',
      status: 'created',
      model: 'gpt-live-1',
      startedAt: new Date(),
      endedAt: null,
      endReason: null,
      finalization: null,
      usage: null,
      error: null,
    })
    return id
  }

  async update(id: string, patch: SessionUpdate) {
    Object.assign(this.rows.get(id) as object, patch)
  }

  async get(id: string) {
    return this.rows.get(id)
  }
}

/** In-memory idempotent transcript persistence for flush tests. */
export class TestTranscriptService implements TranscriptStore {
  chunks = new Map<string, Snapshot>()

  async append(chunks: Snapshot[]) {
    for (const chunk of chunks) {
      if (!this.chunks.has(chunk.id)) {
        this.chunks.set(chunk.id, { ...chunk })
      }
    }
  }

  async read(id: string) {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.sessionId === id)
      .sort((a, b) => a.startMs - b.startMs)
      .map((chunk) => ({ ...chunk, createdAt: new Date() }))
  }
}

/** In-memory memory operations with a controllable write delay. */
export class TestMemoryService implements MemoryStore {
  facts: Memory[] = []
  writes = 0
  beforeWrite: (() => Promise<void>) | undefined

  async search(_input: MemoryQuery) {
    return this.facts
  }

  async remember(sessionId: string, input: MemoryInput) {
    this.writes++
    await this.beforeWrite?.()
    const memory: Memory = {
      id: crypto.randomUUID(),
      sourceSessionId: sessionId,
      content: input.content,
      entity: input.entity,
      eventAt: input.event_at ? new Date(input.event_at) : null,
      fingerprint: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    this.facts.push(memory)
    return memory
  }

  async correct(id: string, input: MemoryInput) {
    const row = this.facts.find((fact) => fact.id === id)
    if (!row) {
      throw new Error('Missing memory')
    }
    row.content = input.content
    return row
  }
}

/** Test provider with observable hangups and a manually controlled sideband. */
export class TestVoiceChatProvider implements VoiceChatProvider {
  readonly hangups: string[] = []

  constructor(readonly socket: TestSocket) {}

  async create(_sdp: string, _signal: AbortSignal) {
    return { sessionId: 'live-test', sdp: 'answer' }
  }

  attach(_id: string) {
    queueMicrotask(() => this.socket.open())
    return this.socket
  }

  async hangup(id: string, _signal: AbortSignal) {
    this.hangups.push(id)
  }
}

export class TestLocationService implements LocationStore {
  position: SavedLocation | null = null

  async save(input: Coordinates) {
    this.position = { ...input, recordedAt: new Date() }
    return this.position
  }

  async latest() {
    return this.position
  }
}

export class TestPlacesService implements PlacesService {
  async nearby() {
    return []
  }
}

/** Explicit reservation dependency for voice tests that do not exercise booking. */
export class TestReservationService implements ReservationStore {
  rows = new Map<string, ReservationState>()
  abandoned: string[] = []
  hotelOptions: HotelOption[] = []
  offeringOptions: OfferingOption[] = []

  async hotels() {
    return this.hotelOptions
  }

  async offerings(hotelId: string, _date: string) {
    return this.offeringOptions.filter(
      (offering) => offering.hotelId === hotelId,
    )
  }

  async get(id: string): Promise<ReservationState | null> {
    return this.rows.get(id) ?? null
  }

  async active(): Promise<ReservationState | null> {
    return [...this.rows.values()].find((row) => row.status === 'draft') ?? null
  }

  async list(): Promise<ReservationState[]> {
    return [...this.rows.values()]
  }

  async create(
    patch: Omit<ReservationPatch, 'revision'> = {},
  ): Promise<ReservationState> {
    for (const row of this.rows.values()) {
      if (row.status === 'draft') {
        this.rows.set(row.id, {
          ...row,
          status: 'abandoned',
          revision: row.revision + 1,
        })
      }
    }

    const state: ReservationState = {
      id: crypto.randomUUID(),
      status: 'draft',
      hotelId: patch.hotelId ?? null,
      hotel: null,
      city: null,
      brand: null,
      stayDate: patch.stayDate ?? null,
      guestName: patch.guestName ?? null,
      rooms: [],
      quotedTotalSar: null,
      confirmedTotalSar: null,
      nextMissingField: 'hotel',
      reason: null,
      revision: 1,
      updatedAt: new Date().toISOString(),
    }
    this.rows.set(state.id, state)
    return state
  }

  async update(
    _id: string,
    _patch: ReservationPatch,
  ): Promise<ReservationState> {
    throw new Error('Reservation not configured in this fixture')
  }

  async confirm(_id: string, _revision: number): Promise<ReservationState> {
    throw new Error('Reservation not configured in this fixture')
  }

  async abandon(id: string): Promise<ReservationState> {
    const row = this.rows.get(id)

    if (!row) {
      throw new Error('Reservation not found')
    }

    const updated = {
      ...row,
      status: 'abandoned' as const,
      revision: row.revision + 1,
    }
    this.rows.set(id, updated)
    this.abandoned.push(id)
    return updated
  }

  async resume(): Promise<ReservationState> {
    throw new Error('Reservation not configured in this fixture')
  }
}

export function voiceFixture(options: VoiceSessionManagerOptions = {}) {
  const sessions = new TestVoiceSessionService()
  const memory = new TestMemoryService()
  const transcripts = new TestTranscriptService()
  const socket = new TestSocket()
  const provider = new TestVoiceChatProvider(socket)
  const location = new TestLocationService()
  const places = new TestPlacesService()
  const reservations = new TestReservationService()
  const manager = new VoiceSessionManager(
    sessions,
    memory,
    transcripts,
    provider,
    location,
    places,
    reservations,
    {
      endTimeoutMs: 200,
      ...options,
    },
  )
  return {
    sessions,
    memory,
    transcripts,
    socket,
    provider,
    location,
    places,
    reservations,
    manager,
    hangups: provider.hangups,
  }
}

export function functionCall(
  socket: TestSocket,
  callId = 'call-1',
  name = 'remember_fact',
  args: unknown = { content: 'I prefer tea', entity: 'user', event_at: null },
) {
  socket.response({
    type: 'response.output_item.done',
    item: {
      type: 'function_call',
      call_id: callId,
      name,
      arguments: JSON.stringify(args),
    },
  })
}
export async function eventually(check: () => boolean) {
  const deadline = Date.now() + 1000
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Condition did not settle')
    }
    await Bun.sleep(5)
  }
}
