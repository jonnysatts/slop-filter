# Claude Code Prompt

Paste the prompt below into Claude Code when pointed at this repo.

---

You are working in the `slop-filter-v2` repository.

Goal:
Prepare and, where credentials allow, complete the production rollout of this service using Jon's actual stack:

- Railway for the Python API runtime
- Supabase for persistence, API clients, and export storage
- Netlify only as an optional static frontend host
- GitHub as the source and deploy trigger

Current repo state to respect:

- The API server is in `server.py`
- The core service is in `slopfilter_engine.py`
- The portable endpoint is `POST /api/portable/slop-check`
- The current browser UI is static and local-first
- Environment variable scaffolding, API key auth hooks, Docker support, Supabase migration scaffolding, and deployment docs already exist

Important constraints:

1. Do not replace the app with a new framework.
2. Preserve the existing local development path.
3. Keep the portable endpoint stable unless a versioned replacement is added.
4. Prefer reversible changes.
5. Do not remove or break the current browser UI.
6. Do not expose unauthenticated public write endpoints.

Your tasks:

1. Audit the current deployment readiness.
   - Read `Dockerfile`
   - Read `.env.example`
   - Read `docs/deployment-playbook.md`
   - Read `docs/railway-supabase-rollout.md`
   - Read `supabase/migrations/20260328_000001_slopfilter_foundation.sql`
   - Read `server.py`
   - Read `slopfilter_engine.py`

2. Finish Railway readiness.
   - Confirm the container binds to Railway's `PORT`
   - Confirm `/api/health` is suitable for Railway healthchecks
   - Add any missing deploy metadata only if truly necessary
   - Keep the service one-container deployable

3. Replace local-file persistence with Supabase-backed persistence.
   - Create a small persistence layer abstraction
   - Keep local-disk mode as a fallback for development
   - Add a Supabase-backed implementation for:
     - API clients
     - portable slop checks
     - batch runs
     - batch documents
     - voice packs
   - Move export bundle storage to Supabase Storage or document clearly why it remains local temporarily

4. Harden public API security.
   - Keep health unauthenticated
   - Require API keys for non-health API routes
   - Hash API keys before database storage
   - Support `Authorization: Bearer <key>` and `X-API-Key`
   - Add per-client attribution for portable calls
   - Add basic request-size protection and clear error responses

5. Improve portability for external apps.
   - Keep `POST /api/portable/slop-check`
   - Add a versioned alias like `/api/v1/slop-check` if helpful
   - Return a response shape stable enough for external product integrations
   - Keep it simple for apps like JobSeeker

6. Keep mixed document-mode support intact.
   - Do not regress the per-document mode override work in `app.js`
   - Preserve requested vs applied mode in exports or persisted batch data

7. Update docs.
   - Refresh `README.md`
   - Add exact Railway deploy steps
   - Add exact Supabase setup steps
   - Add a short integration example for another app calling the portable endpoint

8. Verify honestly.
   - Run syntax checks
   - Run any available local smoke tests
   - Exercise the portable endpoint locally
   - If credentials are available, deploy to Railway and report the live URL
   - If credentials are not available, stop at a deployment-ready state and say exactly what remains manual

Acceptance criteria:

1. The service can run locally exactly as before.
2. The service can be deployed on Railway without changing code at deploy time.
3. Public API routes are protected by API key auth when keys are configured.
4. The portable endpoint remains callable by external apps.
5. The repo contains a credible Supabase-backed persistence path, not just aspirational notes.
6. Documentation is complete enough that Jon can hand the repo to another operator without losing context.

Delivery format:

- findings first if you discover blockers or architectural risks
- then change summary
- then exact verification results
- then what remains manual, if anything

Be meticulous. Do not make hand-wavy claims about deployment. If something is not verified, say so plainly.

---
