# Phase 4 — deploy API to Render and web app to Vercel

## Goal

Ship the voice agent with reproducible builds, secret separation, health probes, migrations, and a tested live audio path.

## Work sequence

1. Add `infra/render/render.yaml` as the Render Blueprint for one Node web service and managed PostgreSQL in the same region. Set the Blueprint Path to `infra/render/render.yaml` during Render setup; Render otherwise looks for the file at the repository root. The web service runs Hono, owns outbound sideband WebSockets, and exposes `/health/live` and `/health/ready`. Use a paid/appropriate plan if always-on behavior is necessary; verify the selected plan's current limits before release. Render supports outbound WebSockets from services and sends a shutdown signal during deploys. [Render Blueprints](https://render.com/docs/infrastructure-as-code), [Render WebSockets](https://render.com/docs/websocket), [Render service types](https://render.com/docs/service-types)
2. Run database migrations from `packages/database` as an explicit deploy step with a rollback procedure. Keep the API at one instance initially because live sideband sockets are process-owned. On shutdown, mark readiness false, stop accepting new sessions, drain in-flight requests within a deadline, close active sideband sockets, mark affected local sessions interrupted, and close the database pool and other clients. Test a deployment while a session is active.
3. Put `APP_PASSWORD`, `JWT_SIGNING_SECRET`, `OPENAI_API_KEY`, and `DATABASE_URL` exclusively in Render secret settings. Validate them with the API app's T3 Env schema and inject required config into packages. Rotate secrets through documented runbook steps; rotating the JWT signing key also invalidates all existing access and refresh JWTs. Add a Redis-compatible Render Key Value instance only if phase 3 actually uses a cache or queue; prefer its same-region internal URL. [Render Key Value](https://render.com/docs/key-value)
4. Deploy `apps/web` as a Vite site on Vercel. Set only public build variables such as the API base path. Never use `VITE_` for secrets because Vite exposes them to the client build. [Vercel Vite guide](https://vercel.com/docs/frameworks/frontend/vite)
5. Prefer a same-origin `/api/*` rewrite from Vercel to Render for login, refresh, REST, and SDP initiation, with refresh cookie scoped appropriately. Verify the rewrite forwards `application/sdp` bodies, response content type, `Set-Cookie`, and custom response headers. If this is unsuitable, use `app.example.com` and `api.example.com` under one site with explicit credentialed CORS and cookie settings. The ongoing WebRTC media path stays browser-to-OpenAI. [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
6. Configure HTTPS, allowed origins, content security policy, request size limits, cookie flags, log redaction, and error monitoring. Protect or disable Swagger UI in production if it reveals internal routes. Keep `/health/live` publicly readable for Render and restrict diagnostic detail in `/health/ready`.
7. Run the full production smoke test: login, proactive refresh, start/stop voice, microphone denial, generated reply, tool call, cross-session memory retrieval/correction, logout, and fresh login. Repeat on desktop and mobile browsers. Compare latency markers to local baseline and adjust region or query path based on observed bottlenecks.

## Acceptance checks

- Vercel serves the UI and Render serves the API through HTTPS; migrations run once and probes reflect actual service state.
- The refresh cookie survives normal navigation, validates as a refresh JWT, and is cleared on logout through the production routing setup.
- Live voice, sideband tools, and memory work from the deployed site. A Render restart causes an understandable interrupted state and a clean new-session path.
- No secret is embedded in frontend assets, logs, URLs, or OpenAPI examples.
- Deployment instructions identify required environment variables, rollback steps, and the exact smoke test.

## Exit artifact

Production URLs, deployment runbook, measured initial latency baseline, and a short list of observed reliability/performance issues for the next iteration.
