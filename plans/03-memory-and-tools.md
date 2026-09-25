# Phase 3 — durable memory and server-owned tools

## Goal

Give the voice agent durable, correctable memory with keyword, temporal, and entity retrieval. Keep privileged tool execution on the server.

## Work sequence

1. Add migrations in `packages/database` for `transcript_items`, `entities`, `memories`, `memory_entity_links`, `memory_revisions`, and `memory_jobs` as specified in [the architecture](../docs/architecture.md). Keep Drizzle implementation details inside that package and pass its configuration from the API app. Add generated full-text search data and GIN/B-tree indexes. Use a single `default` scope and explain in the UI that the shared password implies shared memory.
2. Capture completed transcript items from Realtime events via a server sideband WebSocket. When the session is created, extract the OpenAI call ID from the `Location` header and attach with `wss://api.openai.com/v1/realtime?call_id=...`. The sideband can monitor and update the live session and respond to tool calls. [Source](https://developers.openai.com/api/docs/guides/voice-server-controls)
3. Persist transcript items idempotently. Queue a durable extraction job keyed by source item. A worker extracts atomic facts and explicit time/entity references, then checks candidate facts against existing active facts. Apply add, supersede/update, retract, or no-op transactionally and write a revision row. Keep raw transcript retention configurable and default to text only; never store raw audio by accident.
4. Implement a bounded memory query service. Support `q` keyword, canonical or aliased entity, event time range, valid-time range, and limit. Return source, timestamp, and confidence. Rank exact entity/fact-key hits and full-text score before recency. Verify query plans on representative data; add Redis cache only if it improves measured tool latency. No embedding service or vector store.
5. Prefetch a small memory context at session creation under a strict time budget. Attach server-owned function definitions: `search_memory`, `remember_fact`, and `correct_memory`. Wait for the sideband to be ready before enabling microphone input for a tool-enabled session, so the first turn cannot outrun the server tool handler. Parse and validate final function-call arguments on the sideband; run the corresponding service methods; send `function_call_output`, then trigger the next response according to the Realtime event flow. The model may request a tool, but only the server decides what may be executed. [Source](https://developers.openai.com/api/docs/guides/realtime-mcp)
6. Add public memory management APIs from the architecture document and a compact UI where the operator can inspect, correct, and retract facts. Show source and temporal status so stale facts are recognizable. Show tool activity in the voice UI without exposing full private arguments by default.
7. Exercise duplicate statements, contradictory corrections, event-vs-valid time, entity aliases, retries, sideband disconnects, slow DB queries, and prompt-size limits. Confirm memory extraction cannot block the current spoken response. Verify a correction is reflected in the next retrieval and that a retracted fact no longer appears.

## MCP extension point

Do not expose the private memory database as a public MCP server in this phase. Keep a `ToolRegistry` or equivalent internal interface so a later adapter can expose selected capabilities through MCP. Current Realtime supports remote MCP tools, but the Realtime API itself executes those calls; importing tools and network round trips can add startup and turn latency. For any future remote MCP connection, allowlist tool names, keep credentials server-configured, and require approval for sensitive writes. [Source](https://developers.openai.com/api/docs/guides/realtime-mcp)

## Acceptance checks

- The agent remembers a stated durable preference across fresh voice sessions, retrieves it by keyword or entity, and handles a time-bounded question correctly.
- Repeating the same fact does not create uncontrolled duplicates. An explicit correction supersedes the prior fact; delete/retract removes it from active recall while keeping an audit revision.
- Tool calls are handled on the server sideband. The browser cannot directly invoke internal tool execution or read the OpenAI API key.
- Memory lookup and extraction failures produce a graceful spoken fallback and are visible in logs; the live audio connection remains usable.
- No vector search, user table, Firebase, or session-concurrency logic is introduced.

## Exit artifact

Documented memory lifecycle, migrations, API schemas, and a voice demo that remembers and corrects a fact across sessions.
