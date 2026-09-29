# Deploy Sarjy to Render and Vercel

The Render Blueprint provisions the Bun API, PostgreSQL, and Key Value. Vercel
builds the Vite UI from the repository root. Requests to `/v1/*` and
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
   three resources and their instance plans before applying.
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

The Blueprint uses free Render plans for the API and PostgreSQL, and the
smallest paid Key Value plan (`256mb`, currently $10/month). Free PostgreSQL
expires after 30 days; upgrade its plan before expiry if reservation data must
be retained. Upgrading an existing free Key Value instance restarts it and
discards its current contents.

## 3. Create the Vercel project

1. Import the same GitHub repository as a Vercel project. Set **Root
   Directory** to the repository root (`.`), so Vercel reads `vercel.ts` and
   the Bun workspace packages. The file sets the Vite framework, install and
   build commands, output directory, and routing rules.
2. In **Settings → Environment Variables**, add `RENDER_API_ORIGIN` with the
   actual Render HTTPS origin from step 2 for **Production**. Add it for
   Preview too if preview deployments should call the same API. Do not set
   `VITE_API_BASE_URL`; the web client should call same-origin `/v1` routes.
3. Deploy. Record the production Vercel origin and set Render
   `ALLOWED_ORIGIN` to that exact origin. Redeploy or restart the Render API
   after changing its environment variable.
4. Redeploy Vercel if the Render URL changes. `vercel.ts` generates proxy
   rewrites from `RENDER_API_ORIGIN` for each deployment.

If using the Vercel CLI instead of Git import, run `vercel login`, then
`vercel link` at the repository root, set `RENDER_API_ORIGIN` on the linked
project, and run `vercel --prod`. The `.vercel` link directory is ignored by
Git. CLI access and network connectivity are required.

## 4. Verify the public app

1. Visit `<vercel-origin>/health/ready`; it should show an `ok` status with
   PostgreSQL and Redis reachable. This checks the Vercel proxy as well as
   the API.
2. Sign in with `APP_PASSWORD`, inspect the login response for a `Set-Cookie`
   header, reload the page, and verify that the session restores. This checks
   whether the external rewrite forwards the refresh cookie as expected.
3. Start a voice session and test microphone permission, speech, captions,
   stopping, live UI events, and transcript retrieval. HTTPS is required for
   microphone and geolocation in regular browsers. Test any new hotel workflow only after
   its code and migrations have been deployed.

The API currently permits a single `ALLOWED_ORIGIN`, so Vercel Preview URLs
cannot use authenticated API routes unless their origin is temporarily
configured on Render. Production should use the stable Vercel domain.
