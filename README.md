# Sarjy

Sarjy is a shared-password voice assistant with a React UI, a Hono/Bun API, and PostgreSQL memory. Browser microphone and assistant audio use GPT-Live over WebRTC. The API owns prompts, model configuration, a private sideband WebSocket, transcript persistence, and Responses-backed memory tools.

## API setup

Requires Bun 1.3.11 and Docker Compose for the container workflow. Copy `.env.example` to `.env` and replace `APP_PASSWORD` and `JWT_SIGNING_SECRET` with local values. The JWT secret must be at least 32 characters. `.env` is ignored by Git. `COOKIE_SECURE=false` is for local HTTP only; set it to `true` behind HTTPS.

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only OpenAI key with access to `gpt-live-1` and `gpt-6-luna`. |
| `APP_PASSWORD` | Shared login password, at least 12 characters. |
| `JWT_SIGNING_SECRET` | HS256 signing secret, at least 32 characters. |
| `DATABASE_URL` | PostgreSQL connection URL. |
| `DATABASE_POOL_MAX`, `DATABASE_POOL_MIN` | Pool size bounds; defaults `10` and `0`. |
| `DATABASE_IDLE_TIMEOUT_MS` | Idle client timeout; defaults to `10000`. `0` disables idle eviction. |
| `DATABASE_CONNECTION_TIMEOUT_MS` | Connection wait timeout; defaults to `3000`. `0` disables it. |
| `DATABASE_QUERY_TIMEOUT_MS` | Query timeout; defaults to `3000`. `0` disables it. |
| `DATABASE_MAX_LIFETIME_SECONDS` | Maximum client lifetime; defaults to `0` (disabled). |
| `REDIS_URL` | Redis URL. Both Redis and PostgreSQL must be reachable before the API starts and while it is ready. |
| `REDIS_CONNECT_TIMEOUT_MS` | Socket connection timeout; defaults to `5000`. |
| `REDIS_PING_TIMEOUT_MS` | Readiness ping timeout; defaults to `2000`. |
| `REDIS_DISABLE_OFFLINE_QUEUE` | Disable queued commands while disconnected; defaults to `false`. |
| `REDIS_RECONNECT_DELAY_MS` | Optional fixed reconnect delay; unset retains node-redis's backoff strategy. |
| `ALLOWED_ORIGIN` | Browser origin allowed to call the API with credentials. |
| `PORT` | API port; defaults to `3000`. |
| `COOKIE_SECURE` | `false` for local HTTP with `SameSite=Lax`; `true` for HTTPS with `SameSite=None; Secure`. Defaults to `true`. |
| `VITE_API_BASE_URL` | Optional public API origin for a deployed web app. Local Vite uses a same-origin proxy by default. |

Start the API, PostgreSQL, Redis, and one-shot migration with:

```sh
cp .env.example .env
docker compose --env-file .env -f infra/local/docker-compose.yaml up --build
```

The web app is at `http://localhost:5173`, the API at `http://localhost:3000`, Swagger UI at `http://localhost:3000/docs`, and the generated schema at `http://localhost:3000/openapi.json`. Health probes are `/health/live` and `/health/ready`. Readiness returns an overall status plus a flat `resources` map with a short status string for each dependency. Rebuild the API or web container after source changes. PostgreSQL and Redis bind to loopback ports `5432` and `6379`; their data is retained in named volumes after a normal `down`.

For a non-Docker API process, start PostgreSQL and Redis yourself, set the URLs in `.env`, then run:

```sh
bun install --frozen-lockfile --linker hoisted
set -a; . ./.env; set +a
bun run migrate
bun run --cwd apps/api dev
bun run --cwd apps/web dev
```

The two `dev` commands run in separate terminals. Vite proxies `/v1` and `/health` to `http://localhost:3000` locally. In Compose, the web service uses the internal API hostname. The UI stores the access token only in memory and restores browser sessions with the HttpOnly refresh cookie. Auth fetching lives in a separate SWR hook under `apps/web/src/hooks`; no global state library is used. Start requests microphone access and connects directly to OpenAI through WebRTC. Mute disables the microphone track while keeping the session active. Stop mutes audio and waits for the server to finish tool results, close the provider session, and flush transcripts before releasing media. Tap the orb if the browser blocks audio autoplay. The assistant handles spoken interruptions; a committed memory write remains saved if speech is interrupted.

Use `bun run typecheck`, `bun run lint`, and `bun run test` for checks. `bun run format` applies Biome formatting. The one-off migration command lives in `apps/scripts` and validates only `DATABASE_URL`. To reset **only local Compose data**, stop the stack and remove its named volumes with `docker compose --env-file .env -f infra/local/docker-compose.yaml down --volumes`.

Login with `POST /v1/auth/login` and JSON `{ "password": "..." }`. It returns a 15-minute access JWT and sets a seven-day HttpOnly refresh cookie. `POST /v1/auth/refresh` issues a new access JWT without extending the cookie lifetime. `POST /v1/auth/logout` clears the browser cookie; the client must also discard its access JWT. Because refresh tokens are stateless, a copied token remains valid until it expires or the signing key changes. Cross-origin browser requests need `credentials: 'include'`; the API allows only `ALLOWED_ORIGIN`. Browsers may still block third-party cookies when the Vercel and Render hosts are on different sites, so the deployment should use a same-site API domain or a same-origin proxy if that occurs.


## Voice and memory

Authenticated voice routes use the in-memory access JWT:

| Method/path | Behavior |
| --- | --- |
| `POST /v1/voice/sessions` | JSON `{sdp}` offer; returns `201` with `{id, sdp}` containing our local UUID and the SDP answer. |
| `GET /v1/voice/sessions/{id}` | Local status, error, and finalization state; the UI polls this to surface sideband/tool failures. |
| `POST /v1/voice/sessions/{id}/end` | Idempotent `204` after bounded cleanup. Check status for confirmed or incomplete finalization. |
| `GET /v1/voice/sessions/{id}/transcripts` | Up to 5,000 snapshots ordered by session time. |

The server creates `gpt-live-1` sessions with `gpt-6-luna` Responses delegation. It attaches one outbound WebSocket per session before returning the answer. The browser data channel receives captions and lifecycle events; private function events and commands are restricted to the server. No API key is returned to the browser. See the official [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc) and [delegation guide](https://developers.openai.com/api/docs/guides/live-delegation).

The server appends transcript fragments every second and on close. Spaces are preserved. Snapshots are text chunks with speaker and millisecond intervals, rather than completed turns or audio recordings. Both transcripts and memories are retained in PostgreSQL.

Memory is shared across this installation. The backend searches before saving durable facts the user explicitly states, recalls relevant facts through bounded keyword/entity/event-time queries, and corrects an existing row by ID. `remember_fact` inserts immediately; `correct_memory` replaces content and metadata in place. An exact normalized content/entity/time fingerprint prevents identical concurrent saves. Paraphrases depend on model retrieval and judgment. Tool retries with the same call ID return the cached result during the session. Failed tools return an honest error to the backend and surface in the UI.

On shutdown, the API rejects new sessions, aborts pending creation, and drains active calls concurrently. Tool results and continuations finish before `session.close`; final usage/reason is saved when `session.closed` arrives. Missing final events are recorded as incomplete, and the server attempts provider hangup. The shutdown budget is 12 seconds inside Compose’s 15-second allowance.

The tests mock provider audio and sidebands. To run the PostgreSQL integration test against a disposable database, use `TEST_DATABASE_URL=postgres://... bun test apps/api/src/voice/services.test.ts`; it applies migrations. A microphone/browser smoke test still requires real model access: state a preference, Stop, Start a fresh session, ask for it, correct it, and verify the revised fact in another session. Also check denied microphone permission, mute, autoplay recovery, and spoken interruption. No automated check sends paid OpenAI requests.
