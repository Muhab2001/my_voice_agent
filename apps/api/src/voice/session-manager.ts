import {
  type LocationStore,
  type MemoryStore,
  ReservationError,
  type ReservationStore,
  type SessionUpdate,
  type Snapshot,
  type TranscriptStore,
  type VoiceSessionStore,
} from '@voice/database'
import type { RemoteResource } from '@voice/resource-manager'
import {
  type EventOf,
  type ResponseEvent,
  type ResponseEventOf,
  type SidebandEvent,
  sidebandEventSchema,
} from './events.js'
import type { PlacesService } from './places.js'
import type { SidebandSocket, VoiceChatProvider } from './provider.js'
import {
  executeLocationTool,
  executeMemoryTool,
  executeReservationTool,
  locationTools,
  memoryTools,
  reservationTools,
} from './tools.js'
import { UIEventChannel } from './ui-event-channel.js'

const reservationToolNames = new Set(reservationTools.map((tool) => tool.name))
const locationToolNames = new Set(locationTools.map((tool) => tool.name))
const memoryToolNames = new Set(memoryTools.map((tool) => tool.name))

/** A final-event waiter installed before sending commands that may resolve it synchronously. */
class Deferred<T> {
  readonly promise: Promise<T>
  private complete!: (value: T) => void

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.complete = resolve
    })
  }

  resolve(value: T) {
    this.complete(value)
  }
}

/** Reject when the wait exceeds its deadline; always release the timer. */
async function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Voice operation timed out')),
          Math.max(1, ms),
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

type Call = {
  signature: string
  result: Promise<string>
}

type ResponseWork = {
  calls: Set<string>
  done: boolean
  continued: boolean
  completed: Set<string>
  pending: Set<Promise<void>>
}

type ActiveSession = {
  id: string
  reservationId?: string
  providerSessionId: string
  socket: SidebandSocket
  opened: Deferred<boolean>
  closed: Deferred<boolean>
  final?: SessionUpdate
  lost: boolean
  closing: boolean
  closeSent: boolean
  ending?: Promise<void>
  failure?: string
  buffer: Snapshot[]
  retry: Snapshot[]
  flush: Promise<void>
  calls: Map<string, Call>
  responses: Map<string, ResponseWork>
  timer: ReturnType<typeof setInterval>
  seen: Set<string>
  usage: Record<string, unknown>
}

/** Sideband-open, close and transcript-flush intervals, expressed in milliseconds. */
export type VoiceSessionManagerOptions = {
  openTimeoutMs?: number
  endTimeoutMs?: number
  flushIntervalMs?: number
}

/** Owns provider transports, delegated tool work and transcript flushes through finalization. */
export class VoiceSessionManager implements RemoteResource {
  private active = new Map<string, ActiveSession>()
  readonly uiEventChannel = new UIEventChannel()

  /** Setup tasks are tracked separately until they become active or finish cleanup. */
  private creating = new Map<AbortController, Promise<unknown>>()

  private draining = false

  async ping() {
    return {
      healthy: !this.draining,
      details: this.draining
        ? 'Voice sessions are draining'
        : 'Voice sessions are ready',
    }
  }

  async close(): Promise<void> {
    await this.drain()
  }

  constructor(
    private readonly sessions: VoiceSessionStore,
    private readonly memory: MemoryStore,
    private readonly transcriptService: TranscriptStore,
    private readonly voice: VoiceChatProvider,
    private readonly location: LocationStore,
    private readonly places: PlacesService,
    private readonly reservations: ReservationStore,
    private options: VoiceSessionManagerOptions = {},
  ) {
    const dependencies = {
      sessions,
      memory,
      transcripts: transcriptService,
      voice,
      location,
      places,
      reservations,
    }

    for (const [name, service] of Object.entries(dependencies)) {
      if (!service) {
        throw new Error(`Voice dependency ${name} is required`)
      }
    }
  }

  /** Start a fully managed session; reject requests during shutdown. */
  async create(sdp: string): Promise<{ id: string; sdp: string }> {
    if (this.draining) {
      throw new Error('Voice service is draining')
    }

    const controller = new AbortController()
    const task = this.createSession(sdp, controller)

    // Track setup before awaiting it: shutdown must abort and await sessions not yet active.
    this.creating.set(controller, task)

    try {
      return await task
    } finally {
      this.creating.delete(controller)
    }
  }

  private async createSession(sdp: string, controller: AbortController) {
    const id = await this.sessions.create()
    let providerSessionId: string | undefined
    let state: ActiveSession | undefined

    try {
      if (this.draining) {
        throw new Error('Voice service is draining')
      }

      const result = await this.voice.create(sdp, controller.signal)
      providerSessionId = result.sessionId
      await this.sessions.update(id, {
        vendorSessionId: providerSessionId,
      })

      if (this.draining || controller.signal.aborted) {
        throw new Error('Voice service is draining')
      }

      const socket = this.voice.attach(providerSessionId)
      state = {
        id,
        providerSessionId,
        socket,
        opened: new Deferred<boolean>(),
        closed: new Deferred<boolean>(),
        lost: false,
        closing: false,
        closeSent: false,
        buffer: [],
        retry: [],
        flush: Promise.resolve(),
        calls: new Map(),
        responses: new Map(),
        timer: setInterval(() => {
          if (state) {
            void this.flush(state).catch(() =>
              this.fail(
                state as ActiveSession,
                'Transcript persistence failed',
              ),
            )
          }
        }, this.options.flushIntervalMs ?? 1000),
        seen: new Set(),
        usage: {},
      }
      const session = state
      this.active.set(id, session)
      // Install every listener before waiting for open. Attach does not need session.start.
      socket.addEventListener('open', () => session.opened.resolve(true))
      socket.addEventListener('message', (message) => {
        try {
          this.receive(
            session,
            JSON.parse(String((message as MessageEvent).data)),
          )
        } catch {
          this.fail(session, 'Invalid sideband event')
        }
      })
      socket.addEventListener('error', () => {
        session.opened.resolve(false)
        this.fail(session, 'Sideband connection failed')
      })
      socket.addEventListener('close', () => {
        session.lost = true
        session.opened.resolve(false)
        session.closed.resolve(false)

        if (!session.final) {
          this.fail(session, 'Sideband connection lost')
        }
      })

      if (socket.readyState === 1) {
        session.opened.resolve(true)
      }

      if (
        !(await timeout(
          session.opened.promise,
          this.options.openTimeoutMs ?? 5000,
        ))
      ) {
        throw new Error('Sideband connection failed')
      }

      if (this.draining || session.closing || session.final) {
        throw new Error('Voice session closed during setup')
      }

      await this.sessions.update(id, { status: 'active' })

      if (this.draining || session.closing) {
        throw new Error('Voice service is draining')
      }

      return { id, sdp: result.sdp }
    } catch {
      if (state) {
        state.failure = 'Session setup failed'
        await this.end(id)
      } else {
        if (providerSessionId) {
          await this.hangup(providerSessionId)
        }

        await this.sessions.update(id, {
          status: 'failed',
          endedAt: new Date(),
          endReason: 'setup_failed',
          finalization: 'incomplete',
          error: 'Session setup failed',
        })
      }

      throw new Error('Could not establish the voice session')
    }
  }

  private send(session: ActiveSession, event: Record<string, unknown>) {
    if (session.socket.readyState !== 1 || session.closeSent) {
      throw new Error('Sideband unavailable')
    }

    session.socket.send(
      JSON.stringify({ event_id: crypto.randomUUID(), ...event }),
    )
  }

  private fail(session: ActiveSession, message: string) {
    session.failure ??= message
    void this.end(session.id).catch(() =>
      console.error('Voice cleanup failed', { sessionId: session.id }),
    )
  }

  /** Deduplicate sideband deliveries and ignore unrecognized events for forward compatibility. */
  private receive(session: ActiveSession, payload: unknown) {
    const parsed = sidebandEventSchema.safeParse(payload)

    if (!parsed.success) {
      return
    }

    const event = parsed.data

    if (this.isDuplicate(session, event)) {
      return
    }

    switch (event.type) {
      case 'session.input_transcript.delta':
        this.receiveTranscript(session, event, 'user')
        break
      case 'session.output_transcript.delta':
        this.receiveTranscript(session, event, 'assistant')
        break
      case 'session.usage.updated':
        this.receiveUsage(session, event)
        break
      case 'session.closed':
        this.receiveClosed(session, event)
        break
      case 'error':
        this.receiveError(session)
        break
      case 'session.delegation.created':
        this.receiveDelegation(session, event)
        break
      case 'response.event':
        this.receiveResponseEnvelope(session, event)
        break
      default:
        break
    }
  }

  /** Ignore repeated event IDs while keeping the transport deduplication window bounded. */
  private isDuplicate(session: ActiveSession, event: SidebandEvent): boolean {
    if (!event.event_id) {
      return false
    }

    if (session.seen.has(event.event_id)) {
      return true
    }

    session.seen.add(event.event_id)

    if (session.seen.size > 10000) {
      session.seen.delete(session.seen.values().next().value as string)
    }

    return false
  }

  /**
   * Input/output transcript deltas are partial text, not completed turns. Preserve spaces and
   * skip malformed intervals.
   */
  private receiveTranscript(
    session: ActiveSession,
    event: EventOf<
      'session.input_transcript.delta' | 'session.output_transcript.delta'
    >,
    role: Snapshot['role'],
  ) {
    const previous = session.buffer.at(-1)

    if (previous?.role === role) {
      previous.text += event.delta
      previous.endMs = event.end_ms
    } else {
      session.buffer.push({
        id: crypto.randomUUID(),
        sessionId: session.id,
        role,
        text: event.delta,
        startMs: event.start_ms,
        endMs: event.end_ms,
      })
    }
  }

  /** Usage updates are cumulative; replace the voice total rather than adding it twice. */
  private receiveUsage(
    session: ActiveSession,
    event: EventOf<'session.usage.updated'>,
  ) {
    session.usage.voice = event.usage
  }

  /**
   * session.closed confirms finalization. Resolve the waiter before idempotent cleanup,
   * retaining provider reason and usage.
   */
  private receiveClosed(
    session: ActiveSession,
    event: EventOf<'session.closed'>,
  ) {
    session.final = {
      endReason: event.reason,
      finalization: 'confirmed',
      usage: { ...session.usage, voice: event.usage },
    }
    session.closed.resolve(true)
    void this.end(session.id).catch(() =>
      console.error('Voice finalization failed', { sessionId: session.id }),
    )
  }

  /** Provider errors end the local session gracefully without exposing raw provider payloads. */
  private receiveError(session: ActiveSession) {
    this.fail(session, 'Voice provider reported an error')
  }

  /** Track Responses delegations before output arrives; ignore new work once shutdown starts. */
  private receiveDelegation(
    session: ActiveSession,
    event: EventOf<'session.delegation.created'>,
  ) {
    if (session.closing) {
      return
    }

    const delegation = event.delegation

    if (
      delegation.target === 'responses' &&
      !session.responses.has(delegation.id)
    ) {
      session.responses.set(delegation.id, {
        calls: new Set(),
        done: false,
        continued: false,
        completed: new Set(),
        pending: new Set(),
      })
    }
  }

  /**
   * response.event wraps a backend event. Skip malformed envelopes; private execution remains
   * on the sideband.
   */
  private receiveResponseEnvelope(
    session: ActiveSession,
    event: EventOf<'response.event'>,
  ) {
    this.receiveResponse(session, event.event, event.delegation_id)
  }

  /** Associate nested backend events with existing work; refuse new delegations during close. */
  private receiveResponse(
    session: ActiveSession,
    event: ResponseEvent,
    delegationId: string | undefined,
  ) {
    const responseId = event.response_id ?? event.response?.id
    const key = delegationId ?? responseId

    if (!key || session.closeSent) {
      return
    }

    let work = session.responses.get(key)

    if (!work) {
      if (session.closing) {
        return
      }

      work = {
        calls: new Set(),
        done: false,
        continued: false,
        completed: new Set(),
        pending: new Set(),
      }
      session.responses.set(key, work)
    }

    switch (event.type) {
      case 'response.output_item.done':
        this.receiveFunctionCall(session, work, event)
        break
      case 'response.completed':
      case 'response.done':
      case 'response.failed':
      case 'response.incomplete':
        this.receiveResponseFinished(session, work, event, key)
        break
      default:
        break
    }
  }

  /**
   * Completed output items may contain a function call. Validate identity, cache outcomes and
   * deliver each result once per response.
   */
  private receiveFunctionCall(
    session: ActiveSession,
    work: ResponseWork,
    event: ResponseEventOf<'response.output_item.done'>,
  ) {
    const item = event.item
    const callId = item.call_id
    const signature = JSON.stringify([item.name, item.arguments])
    let call = session.calls.get(callId)

    if (call && call.signature !== signature) {
      this.fail(session, 'Conflicting tool retry')
      return
    }

    if (!call) {
      let execution: Promise<object>
      const isReservationTool = reservationToolNames.has(item.name)
      const isLocationTool = locationToolNames.has(item.name)
      const isMemoryTool = memoryToolNames.has(item.name)

      if (isReservationTool) {
        execution = executeReservationTool(
          this.reservations,
          this.uiEventChannel,
          session.id,
          item.name,
          item.arguments,
        ).then((result) => {
          if ('reservation' in result) {
            const reservation = result.reservation

            if (
              reservation &&
              typeof reservation === 'object' &&
              'id' in reservation &&
              typeof reservation.id === 'string'
            ) {
              session.reservationId = reservation.id
            }
          }

          return result
        })
      } else if (isLocationTool) {
        execution = executeLocationTool(
          this.location,
          this.places,
          this.uiEventChannel,
          session.id,
          item.name,
          item.arguments,
        )
      } else if (isMemoryTool) {
        execution = executeMemoryTool(
          this.memory,
          session.id,
          item.name,
          item.arguments,
        )
      } else {
        execution = Promise.reject(new Error('Unknown tool'))
      }

      call = {
        signature,
        result: execution
          .then((result) => JSON.stringify({ ok: true, ...result }))
          .catch((error: unknown) => {
            if (isReservationTool && error instanceof ReservationError) {
              return JSON.stringify({
                ok: false,
                code: error.code,
                error: error.message,
              })
            }

            console.error('Tool execution failed', {
              tool: item.name,
              cause: error instanceof Error ? error.message : String(error),
            })
            session.failure ??= isReservationTool
              ? 'Reservation tool failed'
              : isLocationTool
                ? 'Places tool failed'
                : isMemoryTool
                  ? 'Memory tool failed'
                  : 'Unknown tool failed'
            return JSON.stringify({
              ok: false,
              error:
                'Tool operation failed. Do not claim success; explain the failure to the user.',
            })
          }),
      }
      session.calls.set(callId, call)
    }

    if (work.calls.has(callId)) {
      return
    }

    work.calls.add(callId)
    const pending = call.result.then((output) => {
      if (!session.closeSent && !session.lost) {
        this.send(session, {
          type: 'response.item.create',
          item: { type: 'function_call_output', call_id: callId, output },
        })
      }
    })
    work.pending.add(pending)
    void pending
      .finally(() => work.pending.delete(pending))
      .catch(() => this.fail(session, 'Tool result delivery failed'))
  }

  hasActiveSession(id: string): boolean {
    return this.active.has(id)
  }

  /**
   * Terminal backend events settle a response. Retain usage, expose failures, and continue
   * only after every required tool result is sent.
   */
  private receiveResponseFinished(
    session: ActiveSession,
    work: ResponseWork,
    event: ResponseEventOf<
      | 'response.completed'
      | 'response.done'
      | 'response.failed'
      | 'response.incomplete'
    >,
    key: string,
  ) {
    const response = event.response

    if (response?.id && work.completed.has(response.id)) {
      return
    }

    if (response?.id) {
      work.completed.add(response.id)
    }

    work.done = true

    if (response?.usage) {
      session.usage[key] = response.usage
    }

    if (event.type === 'response.failed') {
      session.failure ??= 'Backend response failed'
    }

    if (work.calls.size && !work.continued) {
      work.continued = true
      const continuation = Promise.all(work.pending).then(() => {
        if (!session.closeSent && !session.lost) {
          // Continue existing delegated work even while Stop is draining the session.
          work.done = false
          work.continued = false
          work.calls.clear()
          this.send(session, { type: 'response.create' })
        }
      })
      work.pending.add(continuation)
      void continuation
        .finally(() => work.pending.delete(continuation))
        .catch(() => this.fail(session, 'Backend continuation failed'))
    }
  }

  private flush(session: ActiveSession): Promise<void> {
    session.flush = session.flush
      .catch(() => {})
      .then(async () => {
        const chunks = [...session.retry, ...session.buffer.splice(0)]
        session.retry = []

        try {
          await this.transcriptService.append(chunks)
        } catch (error) {
          session.retry = chunks
          throw error
        }
      })
    return session.flush
  }

  /** Read persisted lifecycle state together with any current sideband/tool error. */
  async status(id: string) {
    const row = await this.sessions.get(id)

    if (!row) {
      return undefined
    }

    const session = this.active.get(id)
    return {
      id,
      status: row.status,
      error: session?.failure ?? row.error,
      finalization: row.finalization,
    }
  }

  /** Read persisted transcript chunks for the local session. */
  async transcripts(id: string) {
    return this.transcriptService.read(id)
  }

  /** Idempotently drain existing tools and final events before releasing the session. */
  end(
    id: string,
    deadline = Date.now() + (this.options.endTimeoutMs ?? 7000),
  ): Promise<void> {
    const session = this.active.get(id)

    if (!session) {
      return Promise.resolve()
    }

    if (session.ending) {
      return session.ending
    }

    session.closing = true
    session.ending = Promise.resolve().then(() =>
      this.finish(session, deadline),
    )
    return session.ending
  }

  private async finish(session: ActiveSession, deadline: number) {
    clearInterval(session.timer)
    const workDeadline =
      deadline - Math.min(3000, Math.max(1, (deadline - Date.now()) / 3))

    try {
      // Continue receiving existing Responses work until all calls and continuations settle.
      while (
        !session.final &&
        !session.lost &&
        [...session.responses.values()].some(
          (work) => !work.done || work.pending.size,
        )
      ) {
        const work = [...session.responses.values()]
        await timeout(
          Promise.all(work.flatMap((item) => [...item.pending])),
          workDeadline - Date.now(),
        )

        if (
          [...session.responses.values()].every(
            (item) => item.done && !item.pending.size,
          )
        ) {
          break
        }

        await timeout(
          new Promise((resolve) => setTimeout(resolve, 10)),
          workDeadline - Date.now(),
        )
      }

      if (!session.final && !session.lost) {
        this.send(session, { type: 'session.close' })
        session.closeSent = true
        await timeout(session.closed.promise, workDeadline - Date.now())
      }
    } catch {
      session.failure ??= 'Session finalization timed out'
    } finally {
      session.closeSent = true
      const hangup = session.final
        ? Promise.resolve()
        : this.hangup(session.providerSessionId)
      session.socket.close()

      try {
        if (session.reservationId) {
          const draft = await this.reservations.get(session.reservationId)

          if (draft?.status === 'draft') {
            await this.reservations.abandon(draft.id, draft.revision)
          }
        }
      } catch (error) {
        if (
          !(
            error instanceof ReservationError &&
            (error.code === 'conflict' || error.code === 'invalid')
          )
        ) {
          session.failure ??= 'Reservation finalization failed'
        }
      }

      try {
        await timeout(
          Promise.all([hangup, this.flush(session)]),
          deadline -
            Date.now() -
            Math.min(1000, Math.max(1, (deadline - Date.now()) / 2)),
        )

        if (session.buffer.length || session.retry.length) {
          await timeout(this.flush(session), deadline - Date.now())
        }
      } catch {
        session.failure ??= 'Final transcript persistence failed'
      }

      try {
        await this.sessions.update(session.id, {
          status: session.failure ? 'failed' : 'ended',
          endedAt: new Date(),
          endReason: session.failure ? 'error' : 'close_requested',
          finalization: 'incomplete',
          usage: session.usage,
          ...session.final,
          error: session.failure ?? null,
        })
      } finally {
        this.uiEventChannel.closeSession(session.id)
        this.active.delete(session.id)
      }
    }
  }

  private async hangup(id: string) {
    try {
      await this.voice.hangup(id, AbortSignal.timeout(1500))
    } catch {
      console.error('Provider hangup unconfirmed', { vendorSessionId: id })
    }
  }

  /**
   * Reject new sessions, abort setup and drain active sessions concurrently within the
   * deadline.
   */
  async drain(deadline = Date.now() + 9000) {
    this.draining = true

    for (const controller of this.creating.keys()) {
      controller.abort()
    }

    const tasks = [
      ...this.creating.values(),
      ...[...this.active.keys()].map((id) => this.end(id, deadline)),
    ]

    try {
      await timeout(Promise.allSettled(tasks), deadline - Date.now())
    } catch {
      this.forceClose()
    }
  }

  /** Abort remaining transports at the shutdown deadline; late tool results cannot be sent. */
  forceClose() {
    this.draining = true

    for (const controller of this.creating.keys()) {
      controller.abort()
    }

    for (const session of this.active.values()) {
      session.failure ??= 'Shutdown deadline reached'
      session.closeSent = true
      session.lost = true
      session.opened.resolve(false)
      session.closed.resolve(false)
      clearInterval(session.timer)
      session.socket.close()
      this.uiEventChannel.closeSession(session.id)
    }
  }
}
