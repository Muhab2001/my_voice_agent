# Deploy Sarjy to Render and Vercel

The Render Blueprint provisions the Bun API and PostgreSQL. Vercel
builds the Vite UI from `apps/web`, with shared workspace packages available
from the repository. Requests to `/v1/*` and
`/health/*` pass through Vercel to Render, so the browser sees one origin.
Verify refresh cookie handling on the live deployment as described below.

## 1. Publish the repository

Commit and push the desired code to GitHub. The current deployment tools read
the repository from GitHub; unpushed local changes are not part of a Render
Blueprint or a Vercel Git deployment. If `gh auth status` fails, run
`gh auth login -h github.com` and complete its prompts before using `gh`.

## 2. Create the Render stack

1. In the Render dashboard, choose **New → Blueprint**, connect the GitHub
   repository, and choose the branch containing `render.yaml`. Review the
   two resources and their instance plans before applying.
2. Supply the requested server secrets: `OPENAI_API_KEY`,
   `GOOGLE_MAPS_API_KEY`, and `APP_PASSWORD` (at least 12 characters). Render
   generates `JWT_SIGNING_SECRET`. Never put these values in Vercel or Git.
3. Set `ALLOWED_ORIGIN` to the exact HTTPS origin that the Vercel project will
   serve, for example `https://your-project.vercel.app`. You can update it in
   the Render API service settings after the Vercel domain is assigned.
4. Apply the Blueprint. Copy the API service's actual HTTPS URL, including
   its hostname but not a trailing slash, such as
   `https://your-api.onrender.com`. The hostname may differ from the service
   name. Confirm `https://your-api.onrender.com/health/ready` reports `ok`.

The Docker start command runs `bun run migrate` before the API starts. This
also applies future database migrations on restart or deploy. A failed
migration stops the API instead of serving incompatible code.

The Blueprint uses free Render plans for the API and PostgreSQL. Free PostgreSQL
expires after 30 days; upgrade its plan before expiry if reservation data must
be retained. If a previous Blueprint already created `sarjy-redis`, remove that
existing Key Value service in Render after deploying this change to stop its
charges. Removing it from `render.yaml` does not itself verify that the live
service was deleted.

## 3. Create the Vercel project

1. Import the same GitHub repository as a Vercel project. Choose **Import
   single project** for the `web` Vite app and keep **Root Directory** at
   `apps/web`, so Vercel reads `apps/web/vercel.ts`. In the Root Directory
   settings, keep **Include source files outside of the Root Directory in the
   Build Step** enabled so the `@voice/contracts` workspace package and root
   `bun.lock` are available. Vercel normally enables this for new projects.
   The file sets the Vite framework, install and build commands, output
   directory, and routing rules.
2. Set the Vercel environment variable `RENDER_API_ORIGIN` to the Render API
   origin, for example `https://sarjy-api.onrender.com` (without a trailing
   slash) on the Vercel project serving the public domain. Each Vercel project
   has separate environment settings. `apps/web/vercel.ts` uses it for `/v1`
   and `/health` routing. Leave `VITE_API_BASE_URL` unset; the web client calls
   same-origin `/v1` routes.
3. Deploy. Record the production Vercel origin and set Render
   `ALLOWED_ORIGIN` to that exact origin. Redeploy or restart the Render API
   after changing its environment variable.
4. Redeploy Vercel if the Render URL changes, after updating
   `RENDER_API_ORIGIN` in the Vercel project settings.

If using the Vercel CLI instead of Git import, run `vercel login`, then
`vercel link` from the repository root and select the `apps/web` project, then
run `vercel --prod`. The
`.vercel` link directory is ignored by Git. CLI access and network connectivity
are required.

## 4. Verify the public app

1. Visit `<vercel-origin>/health/ready`; it should show an `ok` status with
   PostgreSQL reachable. This checks the Vercel proxy as well as
   the API. If it returns the web app's `index.html`, the API route is falling
   through to the SPA route; check the project's deployment and
   `RENDER_API_ORIGIN` setting.
2. Sign in with `APP_PASSWORD`, inspect the login response for a `Set-Cookie`
   header, reload the page, and verify that the session restores. This checks
   whether the external rewrite forwards the refresh cookie as expected.
3. Start a voice session and test microphone permission, speech, captions,
   stopping, and live UI events. HTTPS is required for
   microphone and geolocation in regular browsers. Test any new hotel workflow only after
   its code and migrations have been deployed.

The API currently permits a single `ALLOWED_ORIGIN`, so Vercel Preview URLs
cannot use authenticated API routes unless their origin is temporarily
configured on Render. Production should use the stable Vercel domain.
