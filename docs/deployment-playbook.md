# Deployment Playbook

## What You Already Have

This repo already has the important split:

- `slopfilter_engine.py`: core scoring and rewrite service
- `server.py`: HTTP API
- `index.html` + `app.js`: browser client
- `portable_client.js`: lightweight client for other apps

That means the public product should be treated as:

1. one hosted API service
2. one browser UI that calls it
3. any number of other client apps that call the same API

## Minimum Viable Hosted Version

### 1. Containerise it

This repo now includes a `Dockerfile`.

Build locally:

```bash
docker build -t slop-filter .
```

Run locally:

```bash
docker run --rm -p 8743:8743 slop-filter
```

### 2. Deploy the container

The cleanest portable shape is a single container exposing:

- `GET /api/health`
- `GET /api/config`
- `POST /api/portable/slop-check`
- batch endpoints under `/api/batches`

### 3. Put it behind a public URL

Once deployed, other apps call:

```text
https://your-domain.com/api/portable/slop-check
```

## Recommended Production Shape

### Phase 1: simplest public deployment

Good when:

- you want to get it online quickly
- traffic is low to moderate
- you are comfortable with one service instance

Shape:

- one web service
- one persistent volume or disk mounted for `.slopfilter-data`
- environment-level API key for internal use

### Phase 2: multi-app internal service

Good when:

- multiple apps call this service
- you want rate limits, audit logs, and user separation

Shape:

- API service
- external database for batches, users, keys, and job metadata
- object storage for export bundles
- async worker for larger batch jobs

### Phase 3: public product

Good when:

- you want third parties to integrate with it
- usage becomes bursty or paid

Shape:

- authenticated API keys
- per-key quotas
- webhook or polling for batch completion
- billing and usage tracking

## Hosting Options

### Render

Useful if you want a straightforward web service deploy from Git or Docker. Render documents public web services and notes that services must bind to `0.0.0.0`, and that persistent disks are required if you need filesystem changes to survive redeploys.

Sources:

- [Render Web Services](https://render.com/docs/web-services)
- [Render Persistent Disks](https://render.com/docs/disks)

### Fly.io

Useful if you want container-first deployment with regional placement and attached volumes. Fly documents deploys with `fly deploy` and local persistent storage with volumes.

Sources:

- [Fly deploy](https://fly.io/docs/launch/deploy/)
- [Fly Volumes overview](https://fly.io/docs/volumes/overview/)

### Google Cloud Run

Useful if you want managed container hosting and scale-to-zero. Cloud Run is strong for stateless API serving. If you outgrow local disk storage, pair it with Cloud SQL or object storage instead of relying on container filesystem state.

Sources:

- [Cloud Run deploy container quickstart](https://cloud.google.com/run/docs/quickstarts/deploy-container)
- [Containerize your code for Cloud Run](https://cloud.google.com/run/docs/building/containerize-your-code)

## Important Architectural Decision

Right now the Python service writes batch data to `.slopfilter-data` on local disk.

That is fine for:

- local development
- a single hosted instance
- early internal use

It is not ideal for:

- multiple replicas
- autoscaling API workers
- strong guarantees around persistence and recovery

So the real decision is:

### Option A: ship now with one instance and persistent disk

Best if you want speed.

Do this:

- deploy one service
- mount persistent storage
- use `/api/portable/slop-check` for other apps
- keep batch UI on the same service

### Option B: refactor for a proper shared service

Best if you expect broader use.

Do this:

- move batch metadata out of local JSON into Postgres
- move export bundles out of local disk into object storage
- keep the slop engine pure and stateless
- let the API enqueue batch jobs to a worker

## Security Checklist

Before exposing this publicly:

1. Add API key auth for `/api/portable/*` and `/api/batches/*`
2. Replace `Access-Control-Allow-Origin: *` with an allowlist for your client domains
3. Add request size limits for large text payloads
4. Add rate limiting
5. Log request ids and failures
6. Separate public single-document endpoints from heavier batch endpoints

## Best Near-Term Path

If the goal is to let apps like JobSeeker call this soon, the best path is:

1. Deploy this repo as one containerised service
2. Put it on a public domain
3. Protect `/api/portable/slop-check` with an API key
4. Keep the current UI as your admin and review console
5. Let other apps use only the portable endpoint

That gets portability fast without forcing a full backend rewrite first.
