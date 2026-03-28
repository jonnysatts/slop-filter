create extension if not exists pgcrypto;

create table if not exists public.api_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  api_key_hash text not null unique,
  allowed_origins text[] not null default '{}',
  notes text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.voice_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text not null default 'manual',
  sample_text text not null,
  sample_size integer not null default 0,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.slop_checks (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid references public.api_clients(id) on delete set null,
  source_app text not null default '',
  request_mode text not null,
  document_mode text not null,
  edit_budget text not null,
  rewrite_enabled boolean not null default true,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  original_quality numeric(5,2),
  revised_quality numeric(5,2),
  quality_delta numeric(5,2),
  original_detector_risk numeric(5,2),
  revised_detector_risk numeric(5,2),
  detector_risk_delta numeric(5,2),
  voice_similarity_score numeric(5,2),
  created_at timestamptz not null default now()
);

create table if not exists public.batch_runs (
  id uuid primary key default gen_random_uuid(),
  api_client_id uuid references public.api_clients(id) on delete set null,
  name text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  mode text not null,
  edit_budget text not null,
  batch_default_document_mode text not null default 'fiction',
  house_voice_samples text not null default '',
  voice_pack_id uuid references public.voice_packs(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  target_voice_profile jsonb not null default '{}'::jsonb,
  batch_voice_profile jsonb not null default '{}'::jsonb,
  engine_version text not null default '3.0-alpha',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.batch_documents (
  id uuid primary key default gen_random_uuid(),
  batch_run_id uuid not null references public.batch_runs(id) on delete cascade,
  sequence_no integer not null,
  name text not null,
  status text not null default 'queued',
  progress_label text not null default 'Queued',
  source_type text not null default 'text',
  mode_override text not null default '',
  applied_document_mode text not null default '',
  original_text text not null,
  revised_text text not null default '',
  original_analysis jsonb not null default '{}'::jsonb,
  revised_analysis jsonb not null default '{}'::jsonb,
  residue_audit jsonb not null default '{}'::jsonb,
  acceptance jsonb not null default '{}'::jsonb,
  delta jsonb not null default '{}'::jsonb,
  voice jsonb not null default '{}'::jsonb,
  is_outlier boolean not null default false,
  outlier_reason text not null default '',
  review_state text not null default 'pending',
  notes text not null default '',
  warning text not null default '',
  reruns integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_slop_checks_created_at on public.slop_checks(created_at desc);
create index if not exists idx_batch_runs_created_at on public.batch_runs(created_at desc);
create index if not exists idx_batch_documents_batch_run_id on public.batch_documents(batch_run_id, sequence_no);

comment on table public.api_clients is 'API clients allowed to call the hosted Slop Filter service.';
comment on table public.slop_checks is 'Single-document portable API calls such as JobSeeker cover-letter rewrites.';
comment on table public.batch_runs is 'Batch-level metadata for the full Slop Filter review workflow.';
comment on table public.batch_documents is 'Per-document state for hosted batch review and export.';
