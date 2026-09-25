# Voice agent

The phase 1 API is implemented. The browser UI and simulated audio from the rest of phase 1 are still planned.

## API setup

Requires Bun 1.3.11, Node 22, and Docker Compose for the container workflow. Copy `.env.example` to `.env` and replace `APP_PASSWORD` and `JWT_SIGNING_SECRET` with local values. The JWT secret must be at least 32 characters. `.env` is ignored by Git. `COOKIE_SECURE=false` is for local HTTP only; set it to `true` behind HTTPS.

| Variable | Purpose |
| --- | --- |
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

Start the API, PostgreSQL, Redis, and one-shot migration with:

```sh
cp .env.example .env
docker compose --env-file .env -f infra/local/docker-compose.yaml up --build
```

The API is at `http://localhost:3000`, Swagger UI at `http://localhost:3000/docs`, and the generated schema at `http://localhost:3000/openapi.json`. Health probes are `/health/live` and `/health/ready`. Readiness returns an overall status plus a flat `resources` map with a short status string for each dependency. API source files are watched in the container. PostgreSQL and Redis bind to loopback ports `5432` and `6379`; their data is retained in named volumes after a normal `down`.

For a non-Docker API process, start PostgreSQL and Redis yourself, set the URLs in `.env`, then run:

```sh
bun install --frozen-lockfile
set -a; . ./.env; set +a
bun run migrate
bun run --cwd apps/api dev
```

Use `bun run typecheck`, `bun run lint`, and `bun run test` for checks. `bun run format` applies Biome formatting. The one-off migration command lives in `apps/scripts` and validates only `DATABASE_URL`. To reset **only local Compose data**, stop the stack and remove its named volumes with `docker compose --env-file .env -f infra/local/docker-compose.yaml down --volumes`.

Login with `POST /v1/auth/login` and JSON `{ "password": "..." }`. It returns a 15-minute access JWT and sets a seven-day HttpOnly refresh cookie. `POST /v1/auth/refresh` issues a new access JWT without extending the cookie lifetime. `POST /v1/auth/logout` clears the browser cookie; the client must also discard its access JWT. Because refresh tokens are stateless, a copied token remains valid until it expires or the signing key changes. Cross-origin browser requests need `credentials: 'include'`; the API allows only `ALLOWED_ORIGIN`. Browsers may still block third-party cookies when the Vercel and Render hosts are on different sites, so the deployment should use a same-site API domain or a same-origin proxy if that occurs.

## Plans

- [Architecture, schema, API, and latency design](docs/architecture.md)
- [Phase 1 — scaffold and simulated audio](plans/01-scaffold.md)
- [Phase 2 — live Realtime audio](plans/02-realtime-audio.md)
- [Phase 3 — durable memory and tools](plans/03-memory-and-tools.md)
- [Phase 4 — Render and Vercel deployment](plans/04-deployment.md)

The phases are ordered. Each plan includes deliverables, an implementation sequence, and acceptance checks. Firebase, user accounts, and concurrent-session quotas are intentionally outside this version.
