import { expect, test } from 'bun:test'
import type { MemoryService } from '@voice/database'
import {
  eventually,
  functionCall,
  TestReservationService,
  voiceFixture,
} from '../testing/voice-fixture.js'
import { VoiceSessionManager } from './session-manager.js'

test('saves both speakers under the local ID, preserving spaces and final usage', async () => {
  const { manager, socket, sessions, transcripts } = voiceFixture({
    flushIntervalMs: 10,
  })
  const { id, sdp } = await manager.create('offer')

  expect(sdp).toBe('answer')

  expect(sessions.rows.get(id)?.vendorSessionId).toBe('live-test')
  socket.event({
    type: 'session.input_transcript.delta',
    delta: 'I prefer',
    start_ms: 0,
    end_ms: 100,
  })
  socket.event({
    type: 'session.input_transcript.delta',
    delta: ' tea.',
    start_ms: 100,
    end_ms: 200,
  })
  await eventually(() => transcripts.chunks.size === 1)
  socket.event({
    type: 'session.output_transcript.delta',
    delta: 'Got it.',
    start_ms: 200,
    end_ms: 300,
  })
  await manager.end(id)

  expect(
    (await manager.transcripts(id)).map(({ role, text }) => [role, text]),
  ).toEqual([
    ['user', 'I prefer tea.'],
    ['assistant', 'Got it.'],
  ])

  expect(sessions.rows.get(id)?.finalization).toBe('confirmed')

  expect(sessions.rows.get(id)?.usage).toEqual({ voice: { seconds: 4 } })

  expect(socket.readyState).toBe(3)

  expect(socket.sent.some((event) => event.type === 'session.start')).toBe(
    false,
  )
  await manager.end(id)

  expect(
    socket.sent.filter((event) => event.type === 'session.close'),
  ).toHaveLength(1)
})

test('ending an older session does not abandon a newer reservation draft', async () => {
  const { manager, socket, reservations } = voiceFixture()
  const { id } = await manager.create('offer')
  functionCall(socket, 'reservation-start', 'start_reservation', {
    hotel_name: null,
    stay_date: null,
    guest_name: 'Amina',
    rooms: null,
  })
  socket.response({
    type: 'response.completed',
    response: { id: 'reservation-response' },
  })
  await eventually(() =>
    socket.sent.some(
      (event) =>
        event.type === 'response.item.create' &&
        (event.item as { call_id?: string })?.call_id === 'reservation-start',
    ),
  )
  const first = [...reservations.rows.values()][0]
  expect(first).toBeDefined()
  const newer = await reservations.create()
  await manager.end(id)
  expect(reservations.abandoned).not.toContain(newer.id)
  expect((await reservations.get(newer.id))?.status).toBe('draft')
})

test('ending a session abandons the draft it created', async () => {
  const { manager, socket, reservations } = voiceFixture()
  const { id } = await manager.create('offer')
  functionCall(socket, 'reservation-start', 'start_reservation', {
    hotel_name: null,
    stay_date: null,
    guest_name: null,
    rooms: null,
  })
  socket.response({
    type: 'response.completed',
    response: { id: 'reservation-response' },
  })
  await eventually(() =>
    socket.sent.some(
      (event) =>
        event.type === 'response.item.create' &&
        (event.item as { call_id?: string })?.call_id === 'reservation-start',
    ),
  )
  const draft = [...reservations.rows.values()][0]
  expect(draft).toBeDefined()
  await manager.end(id)
  expect(reservations.abandoned).toContain(draft?.id)
})

test('reservation updates reach the reservation service and publish saved state', async () => {
  const { manager, socket, reservations } = voiceFixture()
  const draft = await reservations.create()
  reservations.update = async (key, patch) => {
    const current = await reservations.get(key)

    if (!current) {
      throw new Error('Reservation not found')
    }

    const updated = {
      ...current,
      guestName: patch.guestName ?? current.guestName,
      revision: current.revision + 1,
    }
    reservations.rows.set(key, updated)
    return updated
  }
  const { id } = await manager.create('offer')
  functionCall(socket, 'reservation-update', 'update_reservation', {
    reservation_id: draft.id,
    revision: draft.revision,
    hotel_name: null,
    stay_date: null,
    guest_name: 'Amina',
    rooms: null,
  })
  socket.response({
    type: 'response.completed',
    response: { id: 'reservation-response' },
  })
  await eventually(() =>
    socket.sent.some(
      (event) =>
        event.type === 'response.item.create' &&
        (event.item as { call_id?: string })?.call_id === 'reservation-update',
    ),
  )

  expect((await reservations.get(draft.id))?.guestName).toBe('Amina')
  expect((await manager.status(id))?.error).toBeNull()
  const output = socket.sent.find(
    (event) =>
      event.type === 'response.item.create' &&
      (event.item as { call_id?: string })?.call_id === 'reservation-update',
  )?.item as { output: string }
  expect(JSON.parse(output.output)).toMatchObject({
    ok: true,
    reservation: { id: draft.id, guestName: 'Amina' },
  })
  await manager.end(id)
})

test('Stop waits for committed tools, all results, and their backend continuation', async () => {
  const { manager, socket, sessions, memory } = voiceFixture()
  const { id } = await manager.create('offer')
  let release!: () => void
  memory.beforeWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })

  functionCall(socket)

  functionCall(socket) // Same call delivered with another outer event ID.
  socket.response({
    type: 'response.completed',
    response: { id: 'response-1' },
  })
  socket.autoContinue = false
  const ending = manager.end(id)

  expect(manager.end(id)).toBe(ending)
  await Bun.sleep(10)

  expect(socket.sent).toHaveLength(0)

  release()
  await eventually(() =>
    socket.sent.some((event) => event.type === 'response.create'),
  )

  expect(socket.sent.map((event) => event.type)).toEqual([
    'response.item.create',
    'response.create',
  ])

  expect(memory.writes).toBe(1)

  expect(memory.facts).toHaveLength(1)
  socket.response({
    type: 'response.completed',
    response: { id: 'response-2' },
  })
  await ending

  expect(socket.sent.at(-1)?.type).toBe('session.close')

  expect(sessions.rows.get(id)?.finalization).toBe('confirmed')
})

test('replayed writes in a later response return cached outcomes', async () => {
  const { manager, socket, memory } = voiceFixture()
  const { id } = await manager.create('offer')

  functionCall(socket)
  socket.response({ type: 'response.completed', response: { id: 'first' } })
  await eventually(() => socket.continuation === 1)

  functionCall(socket)
  socket.response({ type: 'response.completed', response: { id: 'second' } })
  await eventually(() => socket.continuation === 2)

  expect(memory.writes).toBe(1)
  const outputs = socket.sent.filter(
    (event) => event.type === 'response.item.create',
  )

  expect(outputs).toHaveLength(2)

  expect(outputs[0].item).toEqual(outputs[1].item)
  await manager.end(id)
})

test('multiple function calls submit all results before continuation', async () => {
  const { manager, socket, memory } = voiceFixture()
  const { id } = await manager.create('offer')

  functionCall(socket, 'call-1')

  functionCall(socket, 'call-2')
  socket.response({ type: 'response.completed', response: { id: 'first' } })
  await eventually(() => socket.continuation === 1)

  expect(memory.writes).toBe(2)

  expect(socket.sent.map((event) => event.type)).toEqual([
    'response.item.create',
    'response.item.create',
    'response.create',
  ])
  await manager.end(id)
})

test('unknown tools and invalid arguments return honest errors without writing', async () => {
  const { manager, socket, memory } = voiceFixture()
  const { id } = await manager.create('offer')

  functionCall(socket, 'invalid-name', 'delete_all_memories')

  functionCall(socket, 'invalid-json', 'remember_fact', {
    content: '',
    entity: 'user',
    event_at: null,
  })
  socket.response({ type: 'response.completed', response: { id: 'first' } })
  await eventually(() => socket.continuation === 1)

  expect(memory.writes).toBe(0)
  const outputs = socket.sent.filter(
    (event) => event.type === 'response.item.create',
  )
  for (const event of outputs) {
    expect(JSON.parse((event.item as { output: string }).output).ok).toBe(false)
  }

  expect((await manager.status(id))?.error).toBe('Unknown tool failed')
  await manager.end(id)
})

test('sideband loss flushes captions, hangs up and records incomplete finalization', async () => {
  const { manager, socket, sessions, transcripts, hangups } = voiceFixture()
  const { id } = await manager.create('offer')
  socket.event({
    type: 'session.input_transcript.delta',
    delta: 'Last words',
    start_ms: 0,
    end_ms: 100,
  })
  socket.close()
  await manager.end(id)

  expect(transcripts.chunks.size).toBe(1)

  expect(sessions.rows.get(id)?.status).toBe('failed')

  expect(sessions.rows.get(id)?.finalization).toBe('incomplete')

  expect(hangups).toEqual(['live-test'])

  expect((await manager.status(id))?.error).toContain('Sideband')
})

test('close deadline forces hangup and records unconfirmed usage', async () => {
  const { manager, socket, sessions, hangups } = voiceFixture({
    endTimeoutMs: 20,
  })
  const { id } = await manager.create('offer')
  socket.autoFinalize = false
  await manager.end(id)

  expect(hangups).toEqual(['live-test'])

  expect(sessions.rows.get(id)?.finalization).toBe('incomplete')

  expect(socket.readyState).toBe(3)
})

test('a final database write finishing just after the close deadline does not fail end', async () => {
  const { manager, sessions } = voiceFixture({ endTimeoutMs: 20 })
  const originalUpdate = sessions.update.bind(sessions)
  sessions.update = async (id, patch) => {
    if (patch.endedAt) {
      await Bun.sleep(40)
    }

    await originalUpdate(id, patch)
  }
  const { id } = await manager.create('offer')
  await manager.end(id)
  expect(sessions.rows.get(id)?.status).toBe('ended')
  expect(sessions.rows.get(id)?.finalization).toBe('confirmed')
})

test('failed sideband setup closes the provider session and records local failure', async () => {
  const {
    provider,
    socket,
    sessions,
    memory,
    transcripts,
    location,
    places,
    hangups,
  } = voiceFixture()
  provider.attach = () => socket
  const manager = new VoiceSessionManager(
    sessions,
    memory,
    transcripts,
    provider,
    location,
    places,
    new TestReservationService(),
    {
      openTimeoutMs: 10,
      endTimeoutMs: 20,
    },
  )
  await expect(manager.create('offer')).rejects.toThrow()

  expect(hangups).toEqual(['live-test'])

  expect([...sessions.rows.values()][0].status).toBe('failed')

  expect(socket.readyState).toBe(3)
})

test('draining aborts creation and cleans up late provider completion', async () => {
  const { sessions, memory, transcripts, provider, location, places, hangups } =
    voiceFixture()
  let release!: (value: { sessionId: string; sdp: string }) => void
  let signal: AbortSignal | undefined
  provider.create = async (_sdp, inputSignal) => {
    signal = inputSignal
    return new Promise((resolve) => {
      release = resolve
    })
  }
  const manager = new VoiceSessionManager(
    sessions,
    memory,
    transcripts,
    provider,
    location,
    places,
    new TestReservationService(),
  )
  const creation = manager.create('offer')
  const rejected = creation.then(
    () => null,
    (error: unknown) => error,
  )
  await eventually(() => !!signal)
  const draining = manager.drain()

  expect(signal?.aborted).toBe(true)

  release({ sessionId: 'live-late', sdp: 'answer' })
  await draining

  expect(await rejected).toBeInstanceOf(Error)
  await expect(manager.create('another offer')).rejects.toThrow('draining')

  expect(hangups).toEqual(['live-late'])

  expect([...sessions.rows.values()][0].status).toBe('failed')
})

test('ambiguous snapshot commit retries IDs without duplicating or losing later text', async () => {
  const { manager, socket, sessions, transcripts } = voiceFixture({
    flushIntervalMs: 10,
  })
  const append = transcripts.append.bind(transcripts)
  let once = true
  transcripts.append = async (chunks) => {
    await append(chunks)
    if (once && chunks.length) {
      once = false
      socket.event({
        type: 'session.input_transcript.delta',
        delta: ' later',
        start_ms: 100,
        end_ms: 200,
      })
      throw new Error('Lost acknowledgment')
    }
  }
  const { id } = await manager.create('offer')
  socket.event({
    type: 'session.input_transcript.delta',
    delta: 'First',
    start_ms: 0,
    end_ms: 100,
  })
  await eventually(() => sessions.rows.get(id)?.endedAt !== null)

  expect(
    (await manager.transcripts(id)).map((chunk) => chunk.text).join(''),
  ).toBe('First later')
})

test('Stop also drains a second tool round created by a backend continuation', async () => {
  const { manager, socket, sessions, memory } = voiceFixture({
    endTimeoutMs: 500,
  })
  const { id } = await manager.create('offer')
  socket.autoContinue = false
  let release!: () => void
  let continuations = 0
  const send = socket.send.bind(socket)
  socket.send = (data) => {
    send(data)
    if (JSON.parse(data).type !== 'response.create') {
      return
    }
    continuations++
    if (continuations === 1) {
      memory.beforeWrite = () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
      functionCall(socket, 'second-call', 'remember_fact', {
        content: 'I prefer coffee',
        entity: 'user',
        event_at: null,
      })
      socket.response({
        type: 'response.completed',
        response: { id: 'second-response' },
      })
    } else {
      socket.response({
        type: 'response.completed',
        response: { id: 'final-response' },
      })
    }
  }
  functionCall(socket)
  socket.response({
    type: 'response.completed',
    response: { id: 'first-response' },
  })
  const stopping = manager.end(id)
  await eventually(() => !!release)
  expect(socket.sent.some((event) => event.type === 'session.close')).toBe(
    false,
  )
  release()
  await stopping
  expect(memory.facts).toHaveLength(2)
  expect(continuations).toBe(2)
  expect(sessions.rows.get(id)?.finalization).toBe('confirmed')
})

test('a timed-out tool cannot send late output after transport cleanup', async () => {
  const { manager, socket, sessions, memory } = voiceFixture({
    endTimeoutMs: 30,
  })
  const { id } = await manager.create('offer')
  let release!: () => void
  memory.beforeWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve
    })
  functionCall(socket)
  socket.response({
    type: 'response.completed',
    response: { id: 'first-response' },
  })
  await manager.end(id)
  expect(sessions.rows.get(id)?.finalization).toBe('incomplete')
  expect(socket.readyState).toBe(3)
  const sent = socket.sent.length
  release()
  await eventually(() => memory.facts.length === 1)
  expect(socket.sent).toHaveLength(sent)
})

test('missing persistence service rejects runtime construction', () => {
  const { sessions, transcripts, provider, location, places } = voiceFixture()
  expect(
    () =>
      new VoiceSessionManager(
        sessions,
        undefined as unknown as MemoryService,
        transcripts,
        provider,
        location,
        places,
        new TestReservationService(),
      ),
  ).toThrow('memory is required')
})

test('event dispatcher ignores unknown and malformed events, deduplicates deltas and retains final provider state', async () => {
  const { manager, socket, sessions, transcripts } = voiceFixture()
  const { id } = await manager.create('offer')
  socket.event({ type: 'session.future.notice' })
  socket.event({ type: 'response.event', event: null })
  socket.response({
    type: 'response.output_item.done',
    item: {
      type: 'function_call',
      call_id: 'malformed',
      name: 'remember_fact',
      arguments: 42,
    },
  })
  socket.event({
    type: 'session.delegation.created',
    delegation: { id: 42, target: 'responses' },
  })
  socket.event({ type: 'session.closed', reason: { invalid: true } })
  socket.event({ type: 'session.usage.updated', usage: null })
  socket.dispatchEvent(new MessageEvent('message', { data: 'null' }))

  socket.event({
    type: 'session.input_transcript.delta',
    event_id: 'same-delta',
    delta: 'ignored',
    start_ms: 'invalid',
    end_ms: 20,
  })
  const delta = {
    event_id: 'same-delta',
    type: 'session.input_transcript.delta',
    delta: 'saved',
    start_ms: 0,
    end_ms: 20,
  }
  socket.event(delta)
  socket.event(delta)
  socket.event({ type: 'session.usage.updated', usage: { seconds: 10 } })
  socket.event({ type: 'session.usage.updated', usage: { seconds: 12 } })
  socket.event({
    type: 'session.closed',
    reason: 'expired',
    usage: { seconds: 13 },
  })
  await manager.end(id)
  expect([...transcripts.chunks.values()].map((chunk) => chunk.text)).toEqual([
    'saved',
  ])
  expect(sessions.rows.get(id)?.endReason).toBe('expired')
  expect(sessions.rows.get(id)?.usage).toEqual({ voice: { seconds: 13 } })
  expect(sessions.rows.get(id)?.finalization).toBe('confirmed')
})
