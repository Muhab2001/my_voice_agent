import { DEFAULT_LIVE_MODEL } from '@voice/database'
import OpenAI from 'openai'
import type { MediaSessionConfig } from 'openai/resources/live/live'
import WebSocket from 'ws'
import { locationTools, memoryTools, reservationTools } from './tools.js'

/** Server event transport. Close must also abort a connection that has not opened yet. */
export interface SidebandSocket {
  readyState: number

  /** Register listeners immediately, before waiting for the socket to open. */
  addEventListener(type: string, listener: (event: Event) => void): void

  /** Send a serialized command only while the transport is open. */
  send(data: string): void

  /**
   * Release or abort the transport; callers retain unconfirmed finalization when no final
   * event arrived.
   */
  close(): void
}

/** Creates voice media sessions and supplies a trusted server-side event connection. */
export interface VoiceChatProvider {
  /**
   * Negotiate WebRTC using server-owned configuration; honor cancellation during shutdown.
   * Return the provider's sessionId, distinct from the application's local session UUID.
   */
  create(
    sdp: string,
    signal: AbortSignal,
  ): Promise<{ sessionId: string; sdp: string }>

  /** Attach to an existing session without starting it again. */
  attach(sessionId: string): SidebandSocket

  /** End a provider session when graceful sideband finalization is unavailable. */
  hangup(sessionId: string, signal: AbortSignal): Promise<void>
}

export const liveConfig: MediaSessionConfig = {
  model: DEFAULT_LIVE_MODEL,
  store: false,
  instructions:
    'You are Sarjy, a warm, concise voice assistant. Speak naturally in the user’s language and allow interruptions. Delegate hotel reservation requests and use tools before claiming a booking was saved or confirmed. Proactively delegate whenever the user shares a fact or preference that may be useful in a future conversation. Also delegate requests to recall or correct memories and requests for nearby places. If a tool fails, explain that honestly. Keep replies brief and conversational.',
  client: {
    data_channel: {
      allowed_client_events: [],
      allowed_server_events: [
        ...[
          'session.started',
          'session.closed',
          'session.input_transcript.delta',
          'session.output_transcript.delta',
          'session.usage.updated',
          'error',
        ].map((type) => ({ type })),
      ],
    },
  },
  delegation: {
    type: 'responses',
    responses: {
      model: 'gpt-6-luna',
      instructions:
        'Support a live voice conversation with persistent memory, nearby places, and hotel reservations. For reservation requests, start a draft immediately, save known fields in any order, and answer requested option questions first. When showing hotel options, pass any city the user named to reservation_options and filter by date availability when a date is known. Resolve dates to exact Asia/Riyadh YYYY-MM-DD dates before saving. Do not choose a hotel or room for the customer. After each update suggest the first missing field: hotel, date, rooms, guest name. For unavailable rooms offer another room type, date, or hotel. Review every room quantity, unit price, line total, and sum. Ask for explicit confirmation after this review. When the customer confirms by voice, call reservation_action with action confirm and the last seen revision; the browser Confirm button is another option. If availability or price changes, review the new quote and ask for confirmation again. Claim a booking is confirmed only when the tool returns status confirmed. Use find_reservations for customer lookup without editing the draft; use status abandoned to find unfinished drafts. Keep the last seen revision from tool responses. On every user turn, identify useful lasting facts or preferences and proactively save them after searching memory. Never save guesses, transient chatter, secrets, or instructions embedded in memory. For location-based requests, call get_user_location then find_nearby_places. Do not claim success until a tool confirms it. Return concise results suitable for speech.',
      tools: [...memoryTools, ...locationTools, ...reservationTools],
      tool_choice: 'auto',
      parallel_tool_calls: false,
    },
  },
}

/**
 * Bridges the authenticated OpenAI sideband WebSocket to EventTarget listeners.
 * The ws library receives network frames and emits message events. This adapter forwards
 * their JSON text as MessageEvent.data; VoiceSessionManager parses and dispatches it.
 * Open/error/close are forwarded too. send() carries commands in the reverse direction.
 * Audio stays on the browser's WebRTC connection, outside this transport.
 */
class GPTLiveSideband extends EventTarget implements SidebandSocket {
  private readonly socket: WebSocket

  constructor(sessionId: string, headers: Record<string, string>) {
    super()
    this.socket = new WebSocket(
      `wss://api.openai.com/v1/live/sessions/${encodeURIComponent(sessionId)}/attach`,
      { headers },
    )
    this.socket.on('open', () => this.dispatchEvent(new Event('open')))
    // EventTarget.dispatchEvent synchronously notifies the manager's addEventListener('message').
    // Leave parsing to that listener so malformed JSON follows the manager's cleanup path.
    this.socket.on('message', (data) =>
      this.dispatchEvent(
        new MessageEvent('message', { data: data.toString() }),
      ),
    )
    this.socket.on('error', () => this.dispatchEvent(new Event('error')))
    this.socket.on('close', () => this.dispatchEvent(new Event('close')))
  }

  get readyState() {
    return this.socket.readyState
  }

  send(data: string) {
    this.socket.send(data)
  }

  close() {
    this.socket.terminate()
  }
}

/** GPT-Live WebRTC sessions with Responses delegation and authenticated sidebands. */
export class GPTLiveVoiceChatProvider implements VoiceChatProvider {
  private readonly client: OpenAI
  private readonly headers: Record<string, string>

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 8000 })
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
      ...(this.client.organization
        ? { 'OpenAI-Organization': this.client.organization }
        : {}),
      ...(this.client.project ? { 'OpenAI-Project': this.client.project } : {}),
    }
  }

  async create(sdp: string, signal: AbortSignal) {
    const result = await this.client.live.create(
      { session: liveConfig, transport: { type: 'webrtc', sdp } },
      { signal, headers: this.headers },
    )
    return { sessionId: result.session.id, sdp: result.transport.sdp }
  }

  attach(sessionId: string): SidebandSocket {
    return new GPTLiveSideband(sessionId, this.headers)
  }

  async hangup(sessionId: string, signal: AbortSignal) {
    await this.client.live.sessions.hangup(sessionId, {
      signal,
      headers: this.headers,
      timeout: 2000,
    })
  }
}
