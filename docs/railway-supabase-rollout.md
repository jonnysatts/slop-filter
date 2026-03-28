# Railway + Supabase Rollout

## Recommended Cloud Shape

- `Railway`: runs the Python API container
- `Supabase Postgres`: stores API clients, portable checks, batch metadata, and document state
- `Supabase Storage`: stores export bundles and large review artefacts
- `Netlify`: optional static host for the browser UI
- `GitHub`: source control and deploy trigger

## Why This Shape Fits The Repo

- The current backend is already a long-running Python HTTP service.
- The current repo now supports env-driven ports, auth, request limits, and CORS.
- Railway is a natural host for the current Docker-based runtime.
- Supabase is the right place to move state once the service should survive redeploys, scale beyond one instance, and support multiple client apps.

## Immediate Deploy Settings

Use the current codebase with Railway first:

- build from `Dockerfile`
- mount a volume
- set `SLOPFILTER_DATA_DIR=/data/slopfilter`
- set `SLOPFILTER_API_KEYS`
- set `SLOPFILTER_ALLOWED_ORIGINS`
- keep `/api/health` open

That gets the service live without a refactor.

## Environment Variables

Start with the values shown in `.env.example`.

Minimum production set:

- `PORT`
- `SLOPFILTER_DATA_DIR=/data/slopfilter`
- `SLOPFILTER_API_KEYS=<comma-separated keys>`
- `SLOPFILTER_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app,https://jobseeker.yourdomain.com`
- `SLOPFILTER_MAX_REQUEST_BYTES=512000`

Future Supabase set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET`

## Railway Deployment Sequence

1. Push repo to GitHub.
2. Create a new Railway project from the GitHub repo.
3. Let Railway detect the `Dockerfile`.
4. Add a Volume and mount it at `/data`.
5. Add the environment variables above.
6. Set a healthcheck path of `/api/health`.
7. Add a custom domain like `api.slopfilter.yourdomain.com`.

## Supabase Rollout Sequence

1. Create a Supabase project.
2. Run the SQL migration in `supabase/migrations/20260328_000001_slopfilter_foundation.sql`.
3. Create a Storage bucket named `slopfilter-exports`.
4. Replace local JSON persistence in `slopfilter_engine.py` with Supabase-backed repositories.
5. Hash API keys before storing them in `public.api_clients`.
6. Record portable endpoint usage in `public.slop_checks`.
7. Move batch manifests and export bundles off disk.

## Security Expectations

Before public release:

1. Require API keys for all non-health API routes.
2. Restrict CORS to known client origins.
3. Enforce request-size limits.
4. Hash API keys before database storage.
5. Add per-client usage logging.
6. Rate-limit portable slop-check calls.

## Best Usage Pattern For Other Apps

Apps like JobSeeker should call only:

- `POST /api/portable/slop-check`

Recommended payload pattern:

```json
{
  "text": "draft cover letter",
  "document_mode": "business",
  "mode": "hybrid",
  "edit_budget": "medium",
  "rewrite": true
}
```

That keeps the integration simple while the heavier batch UI remains a separate product surface.
