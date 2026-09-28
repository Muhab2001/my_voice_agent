# Phase 2 — GPT-Live voice, transcripts, and memory tools

## Goal and decisions

Replace simulated audio with GPT-Live over browser WebRTC, using Responses delegation and server-owned memory tools. This plan supersedes conflicting instructions in `docs/architecture.md`; the former phase 3 memory work is included here.

- Keep the existing React UI, Hono/Bun API, authentication, and PostgreSQL packages.
- Use `gpt-live-1` for speech and `gpt-6-luna` as the initial Responses backend. The server owns model configuration and prompts.
- `OPENAI_API_KEY` is already in the root `.env`. Add it to server env validation and pass it into the service; ensure Compose forwards it to the API. No signup or key-creation step.
- Browser audio goes directly to OpenAI. One outbound sideband WebSocket per session handles transcripts, tool calls, and session lifecycle on the server.
- Save transcript text snapshots linked to our local session ID. The backend model decides which memories to save through tools. Use plain entity labels and update memory rows directly on correction. No entity aliases, revision history, memory-management UI, extraction workers, job queue, embeddings, or vector database.

## Implementation

1. **Create and connect sessions.** Add authenticated `POST /v1/voice/sessions`, accepting the browser SDP offer. Create a local `voice_sessions` row, then call `client.live.create` using the OpenAI SDK with `transport: {type: "webrtc", sdp}` and `delegation: {type: "responses", responses: {model, instructions, tools}}`. Persist the returned `session.id` as `vendor_session_id`; update the existing Realtime model constant/default for Live. Return the SDP answer and local session ID. Replace the simulated transport with WebRTC microphone, remote audio, and data-channel handling behind the existing voice hook. Handle permission denial, autoplay, mute, interruption, errors, and Stop.

2. **Own sidebands in a small session manager.** Construct it once in `main.ts` and inject it into Hono. Attach to `wss://api.openai.com/v1/live/sessions/{session_id}/attach` using server credentials and the same connection headers as creation. Register event handlers immediately; wait for socket open with a timeout before returning the session response. Do not send `session.start` on an attached session. Keep sockets and pending operations in a map keyed by local session ID. If setup fails, close the provider session and record the local failure. A lost sideband must surface as an error and trigger bounded session cleanup.

3. **Save simple transcript snapshots.** Add `transcript_snapshots` in `packages/database`: `id`, `session_id` foreign key, `role` (`user` or `assistant`), `text`, `start_ms`, `end_ms`, and `created_at`; index by session and time. Accumulate `session.input_transcript.delta` and `session.output_transcript.delta` separately, preserving spaces. At a short fixed interval, append each speaker's unsaved text as a new row; flush remaining text on Stop and shutdown. These are text chunks, not completed turns: Live has no transcript-done event. Serialize flushes so chunks are not saved twice. Show captions from the browser data channel; persist from the server sideband only.

4. **Let the model manage memory through functions.** Add a simple `memories` table with `id`, `source_session_id`, `content`, optional entity/event-time metadata, and creation/update timestamps. Keep one shared memory scope matching the existing shared-password installation. Register `search_memory`, `remember_fact`, and `correct_memory` in `delegation.responses.tools`. Implement bounded keyword/entity/time queries and memory saves/corrections in the database package; corrections update the existing row without history tables or supersession chains. Prompt the backend to save durable facts or preferences the user actually states, retrieve relevant memories, and correct existing records rather than duplicate them. Keep conversational style and when to delegate in the Live prompt; put memory rules in the backend prompt. No separate extraction model call.

5. **Execute tools on the sideband.** Dispatch `response.event` envelopes and read completed function items from nested `response.output_item.done`. Validate names and JSON arguments, execute the corresponding server function, and return each result with `response.item.create` containing `function_call_output` and the original `call_id`. Track pending calls per response; send `response.create` after all required results are submitted. Handle errors, deduplicate repeated calls, and keep completed write outcomes so a retry does not save a second memory. Private tool execution stays off the browser.

6. **Stop and shut down cleanly.** Add authenticated, idempotent `POST /v1/voice/sessions/{id}/end`. Stop new work, finish required pending tool results/continuations, register the final-event waiter, send `session.close`, and keep receiving until `session.closed` or a deadline. Save final usage/reason, flush text snapshots, then release sockets and browser media. Record incomplete finalization if the connection closes first. On `SIGTERM`/`SIGINT`, mark draining, reject new sessions (including late session-creation completions), stop reconnects, and drain active sessions concurrently before closing PostgreSQL/Redis. Use one overall deadline that leaves cleanup time inside the deployment shutdown allowance; explicitly cancel or close remaining operations when it expires. Persist memory writes immediately rather than waiting for shutdown.

## Acceptance checks

- After login, Start supports a real two-way voice conversation; API keys remain server-only.
- Both speakers' text snapshots are saved under our local session ID and can be read in order.
- A stated preference is saved through `remember_fact`, recalled in a fresh session through `search_memory`, and corrected through `correct_memory`.
- Repeated statements and repeated tool delivery do not duplicate a memory. Keyword/entity/time filters work, corrections replace the current fact, and lookup failures produce an honest spoken fallback. Tool errors and sideband loss are visible.
- Stop and process shutdown drain pending work, flush transcripts, and release resources within the deadline. An interrupted spoken reply does not silently repeat or cancel a committed memory write.
- Run relevant typecheck/lint/tests, including session cleanup and tool retry behavior; update the README and architecture notes to reflect the implemented Live path and remove obsolete Realtime, worker/queue, alias, revision-history, and memory-management assumptions.

References: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [sideband controls](https://developers.openai.com/api/docs/guides/voice-server-controls), [delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation), [transcripts and graceful close](https://developers.openai.com/api/docs/guides/live-conversations).
