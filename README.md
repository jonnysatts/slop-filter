# Slop Filter V3 Alpha

Local-first batch prose refinement with score deltas, voice consistency checks, review workflow, and export bundles.

## What This Build Includes

- polished browser UI for batch review
- drag-drop or multi-file import for `.md` and `.txt`
- shared-voice modes:
  - preserve batch voice
  - house voice
  - hybrid
- document-mode safety:
  - batch default mode
  - per-document override
  - fiction, essay, marketing, business, worldbuilding
- local heuristic scoring for:
  - quality
  - detector risk
  - voice consistency
- per-document review:
  - original
  - revised
  - diff
  - voice diagnostics
- approve, reject, and rerun controls
- ZIP export generation
- stdlib-only Python server and API

## Quick Start

```bash
python3 launch.py
```

That opens the app at [http://127.0.0.1:8743](http://127.0.0.1:8743).

## Files

- `launch.py`: launcher
- `server.py`: stdlib HTTP server and API
- `slopfilter_engine.py`: batch engine, scoring, rewrite pass, voice analysis, export
- `persistence.py`: store abstraction (local disk / Supabase)
- `index.html`: app shell
- `app.js`: UI logic
- `styles.css`: UI styling
- `portable_client.js`: tiny client for calling the portable slop-check endpoint

## Documentation

- [Integration Guide](docs/integration-guide.md) -- everything another application needs to call this API
- [Engine Assessment](docs/engine-assessment.md) -- honest review of the engine's mechanics and ranked improvement areas
- [Deployment Playbook](docs/deployment-playbook.md) -- general hosting options and security checklist
- [Railway and Supabase Rollout](docs/railway-supabase-rollout.md) -- specific deploy sequence for the current stack

## Portable API

You can call the slop engine directly without using the GUI:

`POST /api/v1/slop-check`

Legacy alias:

`POST /api/portable/slop-check`

Example payload:

```json
{
  "text": "Draft cover letter text here",
  "document_mode": "business",
  "mode": "hybrid",
  "edit_budget": "medium",
  "rewrite": true,
  "house_voice_samples": "Short sample of the voice you want to preserve"
}
```

Example browser usage:

```js
const client = createSlopFilterClient('http://127.0.0.1:8743');

const result = await client.slopCheck({
  text: coverLetterDraft,
  document_mode: 'business',
  mode: 'hybrid',
  edit_budget: 'medium',
  rewrite: true,
});

console.log(result.revised.text);
console.log(result.summary);
```

That is the clean path for wiring Slop Filter into another app such as a cover-letter tool, CMS, or internal editor.

## Cloud Deployment

### Railway (API runtime)

1. Push this repo to GitHub.
2. Create a Railway project from the GitHub repo. Railway auto-detects the `Dockerfile`.
3. Add a Volume mounted at `/data`.
4. Set environment variables:
   - `PORT` (Railway sets this automatically)
   - `SLOPFILTER_DATA_DIR=/data/slopfilter`
   - `SLOPFILTER_API_KEYS=your-key-1,your-key-2`
   - `SLOPFILTER_ALLOWED_ORIGINS=https://your-client.netlify.app`
   - `SLOPFILTER_MAX_REQUEST_BYTES=512000`
5. Set healthcheck path: `/api/health`
6. Optionally add a custom domain.

The service binds to `0.0.0.0:$PORT` automatically.

### Supabase (persistence)

Required only when you want data to survive redeploys or need multi-client attribution.

1. Create a Supabase project.
2. Run the migration: `supabase/migrations/20260328_000001_slopfilter_foundation.sql`
3. Create a Storage bucket named `slopfilter-exports` (set to private).
4. Add environment variables to Railway:
   - `SUPABASE_URL=https://your-project.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY=your-service-role-key`
   - `SUPABASE_STORAGE_BUCKET=slopfilter-exports`

When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both set, the service uses Supabase for all persistence. When unset, it falls back to local disk (the default for development).

### Persistence Modes

| Environment | Backend | How |
|---|---|---|
| Local development | JSON on disk (`.slopfilter-data/`) | Default, no config needed |
| Railway without Supabase | JSON on mounted volume | Set `SLOPFILTER_DATA_DIR=/data/slopfilter` |
| Railway with Supabase | Postgres + Storage | Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |

## Integration Example

For another app (e.g. a cover-letter tool) calling the hosted service:

```bash
curl -X POST https://your-railway-domain.up.railway.app/api/v1/slop-check \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "text": "Draft text to check and rewrite",
    "document_mode": "business",
    "mode": "hybrid",
    "edit_budget": "medium",
    "rewrite": true,
    "source_app": "jobseeker"
  }'
```

The response includes `summary.quality_delta`, `summary.detector_risk_delta`, and `revised.text`.

## Architecture

```
persistence.py    -- Store abstraction (LocalStore / SupabaseStore)
slopfilter_engine.py -- Scoring, rewriting, batch processing
server.py         -- HTTP API (stdlib, no framework)
index.html + app.js + styles.css -- Browser UI
```

The `persistence.py` module provides a `create_store()` factory that returns the appropriate backend based on environment variables. The engine and server code are backend-agnostic.

## Notes

- This is an alpha, not a universal detector-bypass machine.
- The current build is strongest on editorial cleanup, batch consistency, and comparative scoring.
- `.docx` and `.pdf` parsing are not fully wired into the browser-side workflow yet.
- The server exposes a lightweight API, but the frontend is intentionally local-first and responsive even without heavy backend orchestration.
