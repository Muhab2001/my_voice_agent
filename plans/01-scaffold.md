# Phase 1 — monorepo, UI, API, and simulated audio

## Goal

Run a composable voice chat shell locally without OpenAI access. Establish the authentication, API documentation, database migration, deployment probe, and Docker Compose foundations that phase 2 needs.

## Deliverables

```text
apps/
  web/                    React + Vite + TypeScript
    src/
      app/                app bootstrap, providers, and route configuration
      pages/              route-level screens (login and voice chat)
      components/         app-local UI, including AudioControls, Transcript, ConnectionStatus, AuthGate
      hooks/              useAuth, useVoiceSession, and other UI orchestration
      themes/             global CSS, design tokens, typography, and theme configuration
      lib/                typed API client and browser utilities
      transports/         simulated and later WebRTC voice transport adapters
      env.ts              T3 Env client schema
  api/                    Hono on Node.js + OpenAPI/Swagger UI
    src/
      env.ts              T3 Env server schema
      main.ts             validate env, create dependencies, start listener, register shutdown
      app.ts              Hono app factory and global middleware
      routes/             health, auth, and later realtime/memory HTTP routes
      middleware/         request IDs, error handling, auth, and origin checks
      services/           voice-session orchestration and app-specific use cases
      openapi/            schema/route registration and Swagger UI wiring
packages/
  contracts/              shared API schemas and types
  database/               backend-only schema, migrations, repository implementations
  cache/                  backend-only Redis client and cache interface
  auth/                   backend-only password checking and stateless JWT logic
  config/                 shared TypeScript/lint settings
infra/
  local/
    docker-compose.yaml   web + API + PostgreSQL + Redis + one-shot migrations
  render/                 Render Blueprint YAML added in phase 4
plans/                    these execution plans
turbo.json
package.json              root workspaces: apps/* and packages/*
bun.lock
.dockerignore
.env.example
```

Use Bun workspaces in the root `package.json` and a committed `bun.lock`. Run Turborepo tasks for `dev`, `build`, `typecheck`, and `lint` through Bun scripts. Use `workspace:*` for local package dependencies and `bun install --frozen-lockfile` in containers and CI. Bun's [workspace](https://bun.com/docs/pm/workspaces) and [lockfile](https://bun.com/docs/pm/lockfile) docs cover this setup. Keep the package graph simple: `web` depends on `contracts`; `api` depends on `contracts`, `database`, `cache`, and `auth`; backend packages depend on neither app. UI components stay in `apps/web` because they are not shared. Use a single theme source in `apps/web/src/themes` with CSS variables for colors, radii, spacing, and typography. shadcn/ui is optional: take only needed primitives and wrap them behind small app-level interfaces instead of spreading vendor component props throughout the app. React itself has no built-in routing convention; keep route screens in `pages/` and route definitions in `app/`, using React Router's declarative mode for this Vite SPA. [React Router declarative routing](https://reactrouter.com/start/declarative/routing)

Use [`@t3-oss/env-core`](https://env.t3.gg/docs/core) with Zod in each app's `env.ts`: `apps/api` validates server variables from `process.env` at startup, and `apps/web` validates only public `VITE_` variables from `import.meta.env`. Packages must not read `process.env` or `import.meta.env`; app composition passes their required, typed values to constructors or factory functions. The migration runner is an API-side entry point that loads the same server env and passes its database config into `packages/database`. Keep secrets out of the web bundle.

## Work sequence

1. Initialize the workspace with `bun init`, root Bun workspaces, and package scripts. Pin the Bun toolchain and the API's Node runtime separately; Bun is the package manager and script runner, while Hono still targets Node.js. Add `.gitignore`, `.dockerignore`, `.env.example`, and setup instructions. Create `infra/local/docker-compose.yaml` to start the Vite web app, Hono API, PostgreSQL, and Redis-compatible service with `docker compose --env-file .env -f infra/local/docker-compose.yaml up --build` from the repo root. Set service build contexts and bind mounts relative to the repo root explicitly, since the Compose file lives under `infra/local`. Use an internal Compose network, named data volumes for PostgreSQL and Redis, health checks for both stores, and loopback-only host ports where local debugging needs them. Keep development credentials in an ignored local `.env`, with safe placeholders in `.env.example`. No Firebase service.
2. Build the Hono server with `GET /health/live`, `GET /health/ready`, shared request ID/error handling, Zod validation, generated `/openapi.json`, and Swagger UI at `/docs`. Keep `main.ts` limited to validated config and dependency construction; `app.ts` composes routes and middleware from injected services, and each route handler lives in its route module. Connect to PostgreSQL and Redis and ping both before constructing other services or starting the listener. Keep Hono-specific cookie handling in API routes. Avoid module-level connections or direct env reads outside `env.ts`. On `SIGTERM`/`SIGINT`, mark readiness false, stop accepting requests, allow in-flight requests a bounded drain period, and close the HTTP listener, database pool, and Redis client. Make shutdown idempotent and test the signal path. Use Hono's OpenAPI integration and Swagger UI. [Hono OpenAPI](https://hono.dev/examples/zod-openapi), [Hono Swagger UI](https://hono.dev/examples/swagger-ui)
3. Create the backend-only `packages/database`, `packages/cache`, `packages/auth`, and `packages/resource_manager` packages. Put the logical schema, Drizzle configuration/adapter, repository implementations, and first migration for a minimal `voice_sessions` table in `database`; keep Drizzle-specific imports inside that package. Put the Redis client and its small cache interface in `cache`, and password/JWT operations in `auth`. Model PostgreSQL and Redis as remote resources with ping and close methods. Run migrations from `apps/scripts` in a one-shot Compose service after PostgreSQL is healthy; start the API only after migration succeeds. Add an explicit, documented local reset command. Validate required variables through each app's T3 Env schema before constructing dependencies.
4. Implement `POST /v1/auth/login`, `POST /v1/auth/refresh`, and `POST /v1/auth/logout`. Compare the submitted password to the env-provided value with a timing-safe comparison after normalizing length. Issue a short-lived access JWT and a longer-lived, signed refresh JWT in an HttpOnly cookie; validate issuer, audience, expiry, signature, and token type separately for both. Use `SameSite=None; Secure` for cross-site HTTPS deployment and `SameSite=Lax` for local HTTP. Refresh issues a new access JWT without extending the refresh JWT's original expiry. There is no single-use rotation or reuse detection without server state. Logout clears the cookie and client access token; an already copied refresh JWT remains valid until expiry or signing-key rotation, so keep its lifetime bounded and document that limitation.
5. Build the web shell: password entry, chat transcript pane, microphone/start-stop button, mute/connection indicators, incoming audio player, error/status region, and keyboard-accessible controls. Keep `AudioControls`, `Transcript`, `ConnectionStatus`, and `AuthGate` independent and driven by simple props.
6. Add `useAuth` and a small typed `apiClient` with one in-flight refresh shared across callers, refresh scheduled ahead of expiry, and a single retry for safe auth-expiry failures. Add `useVoiceSession` behind a transport interface so `SimulatedVoiceTransport` and later `OpenAIWebRTCTransport` share the same state model. The fake transport plays a bundled audio fixture in timed chunks or through the same playback control surface; document that this validates UI behavior, not network streaming latency.
7. Add local smoke checks for Compose startup, PostgreSQL and Redis health, successful migrations, login, refresh, logout cookie clearing, token type/expiry rejection, probes, OpenAPI generation, microphone permission denial, start/stop, simulated incoming audio, and graceful API shutdown. Confirm hot reload works in the web and API containers and that data survives a normal Compose shutdown. Keep the tests focused on behavior that could regress.

## Acceptance checks

- `docker compose --env-file .env -f infra/local/docker-compose.yaml up --build` starts web, API, PostgreSQL, Redis, and the one-shot migration step in the correct order; build and typecheck pass across the monorepo.
- PostgreSQL and Redis report healthy, the migration service succeeds, and the API becomes ready. A normal restart preserves database data; the documented reset removes only local development data.
- A valid password gives API access; an invalid password does not; refresh occurs before access expiry; logout clears browser credentials. Browser refresh keeps the session until the refresh JWT expires or its signing key is rotated.
- The API fails fast on invalid env, constructs dependencies explicitly, becomes unready on shutdown, drains active requests, and closes its connections.
- `/health/live` works without database access; `/health/ready` reflects database availability. Swagger UI renders the actual route schemas.
- A user can press Start, grant or deny microphone access, hear simulated incoming audio, mute, stop, and see accurate status. All controls work with keyboard and screen reader labels.
- No OpenAI API key or other server secret appears in the frontend bundle, URL, or browser storage.

## Exit artifact

Working local scaffold and a brief README with exact environment variables, Compose commands, service URLs, data reset instructions, and a non-Docker development option. The OpenAI signup guidance belongs in phase 2; Firebase setup has been removed from scope.
