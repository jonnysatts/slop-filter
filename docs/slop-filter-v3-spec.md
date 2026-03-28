# Slop Filter V3 Specification

## 1. Product Summary

Slop Filter V3 turns the current prototype into a batch-capable prose refinement and evaluation system.

Its job is not only to "clean up AI prose". Its job is to:

- improve prose quality
- reduce detector risk across a chosen scoring panel
- preserve meaning, names, facts, dialogue, and plot events
- keep a stable voice across a whole batch of related documents

The last point is now a first-class requirement.

If a user uploads ten chapters from the same book, the output must read like ten chapters from the same book. V3 must prevent chapter-to-chapter stylistic drift.

## 2. Core Product Principles

1. Quality before theatre
   V3 should improve specificity, rhythm, trust, density, and stylistic control. It should not pretend there is one magical "AI score".

2. Panel scoring, not single-score fantasy
   Different detectors disagree. V3 will store individual detector outputs and compute a normalised risk index on top.

3. Batch consistency is separate from target voice
   A batch can be internally consistent without matching a desired human style. V3 must support both.

4. Meaning preservation is mandatory
   If the prose gets smoother but changes facts, plot, or intent, the run is a failure.

5. Human review should be efficient, not required for every sentence
   The system should automate most work but make outliers obvious.

## 3. Definitions

- `Project`: a persistent workspace with saved settings, detector panel, and optional voice packs.
- `Batch`: a run containing one or more related documents.
- `Document`: a single input file, for example one chapter.
- `Voice Pack`: a saved style profile learned from exemplar writing.
- `Batch Voice Profile`: the shared stylistic profile inferred from the uploaded batch.
- `Target Voice`: the style V3 is trying to hit. This may come from a voice pack, a batch profile, or a hybrid of both.
- `Edit Budget`: how invasive the rewrite is allowed to be. Values: `minimal`, `medium`, `aggressive`.
- `Detector Panel`: the chosen set of scoring tools and heuristics for a run.
- `Acceptance Gate`: the rules a revised output must pass before it is accepted.

## 4. Goals

### Functional goals

- Support true batch upload and batch export.
- Score original and revised text before and after rewriting.
- Keep all revised documents within a shared voice band.
- Allow users to preserve batch voice, impose a house voice, or blend both.
- Export reports that make chapter-level and batch-level outcomes obvious.
- Support local scorers and optional commercial detector adapters.

### Non-goals

- Guarantee that outputs will pass every detector forever.
- Replace editorial judgment for high-stakes publishing without review.
- Learn a target voice from poor input and blindly preserve all of its flaws.

## 5. User Modes

### Mode A: Preserve Batch Voice

Use when the uploaded documents already belong together and should still sound like the same work after cleanup.

Example:
Ten AI-drafted book chapters should still feel like one book after rewriting.

### Mode B: Apply House Voice

Use when the user supplies human exemplar writing and wants the batch pulled toward that voice.

Example:
A user uploads rough chapters plus three polished human-written chapters and wants all output aligned to the polished voice.

### Mode C: Hybrid

Use when the user wants to preserve batch-specific flavour while moving toward a stronger target voice.

Example:
Keep the current narrator's rough cadence and genre feel, but tighten it toward the author's saved voice pack.

### Mode D: Frozen Series Voice

Use when a project should keep reusing the same saved voice across future batches.

Example:
Book 2 should sound like Book 1 without retraining the profile from scratch.

## 6. User Stories

1. A novelist uploads 10 chapter drafts and wants one run that returns 10 revised chapters, a batch ZIP, a report showing score deltas, and a warning for any chapter that breaks the shared voice.
2. An editor uploads 40 marketing articles and wants a CSV of detector and quality deltas before approving output.
3. A team saves a house voice pack and applies it to future batches without re-entering style examples.
4. A researcher runs the same batch through different detector panels to compare results.
5. A user re-runs only flagged outlier chapters instead of the whole batch.

## 7. Functional Requirements

### 7.1 Ingestion

- Accept `.md`, `.txt`, `.docx`, and `.pdf`.
- Support drag-drop, folder upload, ZIP upload, CLI input path, and API upload.
- Allow optional metadata per document:
  - title
  - sequence number
  - section/chapter label
  - genre
  - POV
  - tense
  - project tag
- Preserve document order inside the batch.

### 7.2 Baseline Analysis

Before any rewrite, V3 must:

- parse and segment each document
- run quality linting on the original
- run detector panel scoring on the original
- compute per-document style features
- compute batch-level voice variance
- identify candidate narrative invariants:
  - named entities
  - numbers
  - dates
  - dialogue spans
  - chapter headings
  - italics/emphasis markers

### 7.3 Voice System

V3 must support four target voice sources:

- `batch_only`
- `voice_pack_only`
- `hybrid`
- `frozen_project_voice`

The system must treat voice as a structured profile, not a prompt paragraph.

Voice features must include:

- sentence length distribution
- paragraph length distribution
- punctuation habits
- contraction rate
- dialogue density
- narration-to-dialogue ratio
- lexical rarity band
- abstract vs concrete noun ratio
- discourse-marker frequency
- cliché and intensifier frequency
- modifier density
- POV and tense stability
- cadence markers such as fragment rate and long-sentence rate

#### Important rule: do not preserve slop as "voice"

When V3 derives a batch voice profile from raw uploaded prose, it must use only the stable stylistic layer and exclude flagged filler, cliché, and obvious low-value patterns.

In practice:

- first detect slop-like spans
- exclude those spans from profile training
- build the batch voice profile from the remaining material

This prevents the system from learning that repetitive filler is part of the intended voice.

### 7.4 Rewrite Pipeline

The rewrite pipeline must be multi-stage:

1. `Segment`
   Split documents into aligned paragraphs and sentence spans with stable IDs.

2. `Annotate`
   Detect quality issues, detector-risk patterns, and voice outliers at span level.

3. `Generate Candidates`
   Produce multiple rewrite candidates per flagged span or paragraph.

4. `Local Score`
   Score candidates for quality, detector risk, semantic fidelity, and voice distance.

5. `Compose Document Draft`
   Assemble the best candidate set into a full revised document.

6. `Batch Consistency Pass`
   Compare each revised document against the target voice and the batch distribution. Re-run outlier sections if needed.

7. `Semantic Verification`
   Check entity preservation, numeric preservation, quote preservation, and embedding similarity.

8. `Rescore`
   Re-run the detector panel and quality panel on the revised output.

9. `Accept or Reject`
   Save the result only if it passes the acceptance gate.

### 7.5 Candidate Generation

V3 must not rely on one single rewrite attempt.

For each flagged unit, the engine should generate `N` candidates, where `N` is configurable by edit budget:

- `minimal`: 2 to 4 candidates
- `medium`: 4 to 8 candidates
- `aggressive`: 8 to 16 candidates

Candidate generation rules:

- preserve meaning
- do not rewrite clean spans
- do not alter locked entities
- do not add explanatory padding
- prefer shorter or equal-length edits unless the user overrides

### 7.6 Batch Consistency Coordinator

This is the subsystem that solves the "10 chapters, 10 voices" problem.

It must:

- keep a target voice centroid for the whole batch
- score each document against that centroid
- compute per-document outlier distance
- detect chapters that are too formal, too clipped, too florid, or too unlike the batch
- selectively re-run outlier spans or full chapters

The coordinator must expose:

- `voice_similarity_score` per document
- `batch_voice_variance` for the whole run
- `outlier_reason` for flagged documents

### 7.7 Scoring and Reporting

V3 must keep separate scores for:

- detector outputs
- quality outputs
- semantic fidelity outputs
- voice consistency outputs

It must provide both per-document and batch-level summaries.

### 7.8 Batch Export

Every completed batch must support a single ZIP export containing:

```text
batch_<timestamp>/
  revised/
    01_chapter-one.md
    02_chapter-two.md
  diffs/
    01_chapter-one.html
    02_chapter-two.html
  reports/
    batch-summary.md
    document-scores.csv
    detector-results.jsonl
    quality-results.jsonl
    voice-consistency.json
    run-manifest.json
```

### 7.9 Review Workflow

The UI and API must support:

- approve all
- approve per document
- reject per document
- re-run a document with different edit budget
- re-run only voice-outlier documents
- compare original vs revised vs diff

## 8. Acceptance Gate

An output may be accepted only if all required checks pass.

Default gate:

- semantic similarity above threshold
- no blocked entity drift
- no blocked number/date drift
- detector risk index not worse than original beyond allowed tolerance
- quality score improved over original
- voice similarity above threshold
- document is not a batch outlier

For chaptered book mode, add:

- sequence order preserved
- chapter heading preserved
- POV and tense do not flip unexpectedly

## 9. Scoring Model

### 9.1 Detector Risk Index

V3 should not flatten all tools into one fake universal truth. Instead it should:

- store raw outputs from each detector
- normalise them onto a common 0 to 100 risk band
- compute a panel summary called `detector_risk_index`
- show both the summary and the raw component scores

### 9.2 Quality Score

Quality scoring should combine:

- rule-based lint hits
- repetition and rhythm metrics
- density and directness metrics
- specificity and concreteness metrics
- model-based editorial judgments

### 9.3 Voice Consistency Score

For each document:

- measure distance to target voice
- measure distance to batch centroid
- measure deviation from configured genre/POV/tense settings

For the batch:

- compute aggregate variance
- identify outliers

## 10. Detectors and Linters

### 10.1 Local/Open Components

Initial local stack:

- stylometric feature extractor
- repetition and burstiness metrics
- sentence-length entropy metrics
- lexical diversity metrics
- entity preservation checker
- Vale
- alex
- write-good
- LanguageTool
- local detector adapters such as Binoculars

### 10.2 External/Commercial Adapters

Optional adapters:

- Pangram
- GPTZero
- Originality.ai
- Copyleaks
- Turnitin, if enterprise access exists

All detector adapters must implement a common interface:

```json
{
  "detector_name": "string",
  "document_id": "string",
  "label": "human|mixed|ai|unknown",
  "raw_score": 0.0,
  "normalised_risk": 0.0,
  "segment_results": [],
  "metadata": {}
}
```

## 11. Architecture

### 11.1 Stack

- Frontend: React + Vite
- Backend API: FastAPI
- Worker queue: RQ
- Queue broker: Redis
- Database: SQLite for local/dev, PostgreSQL for production
- Artifact storage: local filesystem in dev, S3-compatible object storage in production

### 11.2 Services

- `ingest-service`
- `profile-service`
- `rewrite-service`
- `detector-service`
- `scoring-service`
- `export-service`

### 11.3 Model Abstraction

All model providers must be configured through adapters.

No model version should be hard-coded into core business logic.

Each run manifest must record:

- provider
- model name
- model version if available
- prompt template version
- detector panel version

## 12. Data Model

### 12.1 Entities

`projects`
- id
- name
- default_edit_budget
- default_detector_panel
- default_voice_pack_id

`voice_packs`
- id
- project_id
- name
- mode
- source_manifest
- feature_vector
- blocked_phrases
- preferred_phrases
- created_at

`batch_jobs`
- id
- project_id
- status
- mode
- edit_budget
- detector_panel_name
- voice_source
- created_at
- completed_at

`documents`
- id
- batch_job_id
- source_name
- sequence_no
- original_text
- revised_text
- status
- voice_similarity_score
- quality_delta
- detector_risk_delta

`segments`
- id
- document_id
- stable_span_id
- start_offset
- end_offset
- original_text
- revised_text

`annotations`
- id
- segment_id
- type
- severity
- reason

`candidate_rewrites`
- id
- segment_id
- candidate_text
- quality_score
- detector_risk_score
- semantic_score
- voice_distance
- chosen

`score_runs`
- id
- document_id
- phase
- scorer_name
- payload_json

`artifacts`
- id
- batch_job_id
- type
- path

## 13. API Surface

### 13.1 Projects and Voice Packs

- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/voice-packs`
- `GET /api/voice-packs/:id`
- `POST /api/voice-packs/:id/rebuild`

### 13.2 Batch Runs

- `POST /api/batches`
- `POST /api/batches/:id/files`
- `POST /api/batches/:id/run`
- `POST /api/batches/:id/cancel`
- `GET /api/batches/:id`
- `GET /api/batches/:id/documents`
- `POST /api/batches/:id/rerun-outliers`
- `GET /api/batches/:id/export.zip`

### 13.3 Document Operations

- `GET /api/documents/:id`
- `POST /api/documents/:id/rerun`
- `POST /api/documents/:id/approve`
- `POST /api/documents/:id/reject`

## 14. CLI

V3 should ship with a CLI for real batch work.

Examples:

```bash
slopfilter batch run ./chapters --project novel-a --mode preserve-batch-voice --edit-budget medium
slopfilter batch run ./chapters --project novel-a --voice-pack jon-voice --mode hybrid --export zip
slopfilter score ./chapters --panel default
slopfilter rerun-outliers <batch-id>
```

## 15. UI Requirements

### 15.1 Batch Dashboard

The dashboard must show:

- batch progress
- document statuses
- original vs revised score deltas
- voice consistency heatmap
- outlier chapter list
- export actions

### 15.2 Document View

For each document:

- original tab
- revised tab
- diff tab
- annotations tab
- detector results tab
- voice diagnostics tab

### 15.3 Voice Diagnostics

The UI must surface:

- target voice source
- voice similarity score
- batch centroid distance
- dominant drift reasons

Example drift reasons:

- sentence cadence too clipped
- modifier density too high
- diction too formal for batch
- dialogue density too low

## 16. Evaluation Plan

### 16.1 External Benchmarks

Use public detector benchmarks and related evaluation sets where practical, including RAID and detector-robustness literature.

### 16.2 Internal Benchmarks

Build an internal corpus with:

- human-written reference prose
- raw AI-generated prose
- AI-generated prose with manual edits
- multi-chapter book batches
- saved project voice packs

### 16.3 Success Metrics

- median quality score improvement per batch
- median detector risk reduction per selected panel
- semantic drift rate
- entity preservation rate
- batch voice variance
- human reviewer rating for "same-book consistency"

### 16.4 Release Gate for V3

Before release, the system should demonstrate:

- reliable batch ZIP export
- before/after score reporting
- saved voice packs
- outlier chapter detection
- selective rerun of outliers
- stable performance on 10+ document batches

## 17. Risks and Mitigations

### Risk: detector drift

Detectors change over time.

Mitigation:
- version all detectors
- keep raw outputs
- make panels configurable

### Risk: preserving bad source voice

If V3 learns voice from raw AI prose, it may preserve bad habits.

Mitigation:
- build profiles from slop-filtered spans only
- let users supply human exemplars
- support hybrid mode

### Risk: cost explosion from best-of-N rewriting

Mitigation:
- candidate counts tied to edit budget
- cache unchanged spans
- rerun only flagged outliers

### Risk: semantic drift

Mitigation:
- entity locks
- quote locks
- number/date locks
- semantic similarity gate

## 18. Implementation Phases

### Phase 1: Foundation

- FastAPI backend
- RQ workers
- real batch job model
- file ingestion
- ZIP export
- SQLite dev schema

### Phase 2: Baseline Scoring

- original vs revised scoring
- quality panel
- detector adapter interface
- first local metrics

### Phase 3: Voice Packs and Batch Consistency

- saved voice packs
- batch voice profile builder
- outlier detection
- rerun-outlier flow

### Phase 4: Search-Based Rewrite Engine

- stable span IDs
- candidate generation
- candidate scoring
- acceptance gate

### Phase 5: Benchmarking and Hardening

- external benchmark suite
- internal corpus suite
- performance tuning
- documentation

## 19. Recommended First Milestone

The first milestone should be:

`V3 Alpha: Batch jobs + original/revised scoring + ZIP export + batch voice profile + outlier chapter detection`

This is the smallest milestone that meaningfully surpasses V2 and directly addresses the key user need:

multiple related documents in, multiple refined documents out, with proof of score movement and proof of shared voice.
