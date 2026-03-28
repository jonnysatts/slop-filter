# Slop Filter API -- Integration Guide

This document tells another application everything it needs to call the hosted Slop Filter service.

## Base URL

```
https://slop-filter-production.up.railway.app
```

## Authentication

All non-health endpoints require an API key. Send it in one of two ways:

```
Authorization: Bearer <your-api-key>
```

or

```
X-API-Key: <your-api-key>
```

Unauthenticated requests to protected endpoints return `401`.

## Endpoints

### Health check

```
GET /api/health
```

No authentication required. Returns:

```json
{"ok": true, "time": "2026-03-28T05:45:26+00:00"}
```

Use this for uptime monitoring and healthchecks.

### Configuration

```
GET /api/config
```

No authentication required. Returns the engine version, available modes, document modes, and edit budgets. Useful for building dynamic UI against the API.

### Slop check (primary integration endpoint)

```
POST /api/v1/slop-check
```

Legacy alias (identical behaviour):

```
POST /api/portable/slop-check
```

#### Request

```json
{
  "text": "The draft text to analyse and optionally rewrite.",
  "document_mode": "business",
  "mode": "hybrid",
  "edit_budget": "medium",
  "rewrite": true,
  "source_app": "your-app-name"
}
```

#### Fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `text` | string | yes | -- | The prose to check. Maximum ~500KB. |
| `document_mode` | string | no | `"business"` | Controls mode-specific cleanup rules. One of: `fiction`, `essay`, `marketing`, `business`, `worldbuilding`. |
| `mode` | string | no | `"preserve-batch-voice"` | Voice targeting strategy. One of: `preserve-batch-voice`, `house-voice`, `hybrid`. For single-document calls, `hybrid` is usually best. |
| `edit_budget` | string | no | `"medium"` | How aggressively to edit. One of: `minimal`, `medium`, `aggressive`. |
| `rewrite` | boolean | no | `true` | If `false`, the engine analyses but does not rewrite. Useful for scoring only. |
| `source_app` | string | no | `""` | Identifies your application in audit logs. Set this to your app name. |
| `house_voice_samples` | string | no | `""` | A block of text whose voice the rewrite should move towards. Used when `mode` is `house-voice` or `hybrid`. |
| `voice_pack_id` | string | no | `""` | UUID of a previously saved voice pack to use as the target voice. |

#### Response

```json
{
  "engine_version": "3.0-alpha",
  "requested_at": "2026-03-28T05:36:03+00:00",
  "document_mode": "business",
  "mode": "hybrid",
  "edit_budget": "medium",
  "rewrite_enabled": true,
  "target_voice_profile": { ... },
  "summary": {
    "change_count": 3,
    "quality_delta": 9.3,
    "detector_risk_delta": 23.6,
    "voice_similarity_score": 83.5,
    "accepted": true
  },
  "original": {
    "text": "The original input text.",
    "analysis": {
      "quality_score": 72.1,
      "detector_risk": 48.2,
      "scores": {
        "directness": 68.0,
        "density": 71.5,
        "rhythm": 74.0,
        "authenticity": 69.2,
        "specificity": 77.8
      },
      "signals": {
        "filler_hits": 3,
        "modifier_hits": 5,
        "transition_hits": 2,
        "cliche_hits": 1,
        "generic_hits": 4,
        "abstract_hits": 2,
        "repeated_starts": 0,
        "monotonous_runs": 1
      },
      "voice_profile": { ... },
      "sentence_count": 8,
      "word_count": 142,
      "annotations": [ ... ]
    }
  },
  "revised": {
    "text": "The cleaned-up text.",
    "analysis": { ... },
    "annotations": [ ... ]
  }
}
```

#### Key response fields for integrators

| Path | Type | What it tells you |
|---|---|---|
| `summary.quality_delta` | number | Positive = quality improved. This is the headline metric. |
| `summary.detector_risk_delta` | number | Positive = detector risk decreased (good). |
| `summary.voice_similarity_score` | number | 0-100. How close the revised text is to the target voice. |
| `summary.accepted` | boolean | `true` if the rewrite improved at least one metric. |
| `summary.change_count` | integer | Number of sentences changed. 0 means text was clean. |
| `revised.text` | string | The rewritten text. Use this as the output. |
| `original.analysis.quality_score` | number | 0-100 quality score of the input. |
| `original.analysis.detector_risk` | number | 0-100 estimated AI-detection risk of the input. |

#### Error responses

```json
{"error": "Text is required.", "status": 400}
{"error": "Missing or invalid API key.", "status": 401}
{"error": "Payload exceeds 512000 bytes.", "status": 400}
```

## Recommended integration patterns

### Simple: score and rewrite

Send text, get back `revised.text` and `summary.quality_delta`. Display or use the revised version.

```python
import requests

response = requests.post(
    "https://slop-filter-production.up.railway.app/api/v1/slop-check",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={
        "text": draft_text,
        "document_mode": "business",
        "mode": "hybrid",
        "edit_budget": "medium",
        "rewrite": True,
        "source_app": "your-app",
    },
)

result = response.json()
clean_text = result["revised"]["text"]
quality_improved = result["summary"]["quality_delta"] > 0
```

```javascript
const response = await fetch(
  'https://slop-filter-production.up.railway.app/api/v1/slop-check',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY',
    },
    body: JSON.stringify({
      text: draftText,
      document_mode: 'business',
      mode: 'hybrid',
      edit_budget: 'medium',
      rewrite: true,
      source_app: 'your-app',
    }),
  }
);

const result = await response.json();
const cleanText = result.revised.text;
```

### Score only (no rewrite)

Set `rewrite: false` to get analysis without changing the text. Useful for scoring drafts before the user decides to clean them up.

```json
{
  "text": "Draft text",
  "rewrite": false
}
```

The response still includes `original.analysis` with quality scores, detector risk, and annotations. `revised.text` will be identical to `original.text`.

### With voice targeting

If you want the rewrite to match a specific voice (e.g. the user's own writing style), send a sample:

```json
{
  "text": "Draft to rewrite",
  "mode": "hybrid",
  "house_voice_samples": "A paragraph or two of the target voice. The engine extracts cadence, contraction rate, punctuation habits, and lexical diversity from this sample and blends them with the input's natural voice.",
  "rewrite": true
}
```

## What the engine actually does

The Slop Filter is a local heuristic engine. It does not call an LLM. It works by:

1. **Detecting** filler phrases, stacked intensifiers, cliches, abstract vocabulary, monotonous sentence rhythms, and repeated sentence openings.
2. **Scoring** five dimensions: directness, density, rhythm, authenticity, and specificity. These average into a quality score. A separate detector-risk score estimates how "AI-generated" the text reads.
3. **Rewriting** by removing detected filler, adjusting sentence lengths to match the target voice profile, applying contraction bias, and running mode-specific cleanup rules.
4. **Profiling** the voice of both input and output across 14 metrics (sentence length, lexical diversity, punctuation rates, etc.) to measure voice consistency.

It is strongest at editorial cleanup of AI-generated prose. It does not hallucinate or introduce new content. It only removes and restructures.

## Rate limits and payload size

- Maximum request body: 512KB (configurable server-side).
- No per-client rate limiting is currently enforced. This may change.
- The engine processes synchronously. Typical response time is under 200ms for texts up to 5,000 words.

## CORS

The API supports CORS. The server's allowed origins are configured server-side. If your client-side JavaScript gets a CORS error, the server admin needs to add your domain to `SLOPFILTER_ALLOWED_ORIGINS`.

## Versioning

The current engine version is `3.0-alpha`. The `engine_version` field is included in every response. The response shape at `/api/v1/slop-check` is considered stable for integration purposes.
