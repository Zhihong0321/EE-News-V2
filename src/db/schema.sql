-- News crawler v2 schema for Supabase / Postgres.
-- Idempotent: safe to run repeatedly (npm run db:setup).

create table if not exists articles (
  id            bigint generated always as identity primary key,
  source        text not null,
  country       text,
  title         text not null,
  url           text not null unique,
  published_at  timestamptz,
  author        text,
  section       text,
  body          text,
  description   text,
  fetched_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Added after the initial rollout; kept as an ALTER so it applies to existing
-- databases too (create table if not exists alone would skip it).
alter table articles add column if not exists tags text[] not null default '{}';

-- Short (<= 30 word), English-only factual gist distilled from the article by
-- the fetch stage. Comparison key for same-country/recent-window duplicate
-- detection across sources, independent of the original (possibly
-- non-English) title.
alter table articles add column if not exists dedup_title text;

create index if not exists articles_source_idx        on articles (source);
create index if not exists articles_published_at_idx   on articles (published_at desc);
create index if not exists articles_fetched_at_idx     on articles (fetched_at desc);
create index if not exists articles_tags_idx           on articles using gin (tags);

-- One enrichment record per article (the latest infographic-content packet).
create table if not exists article_enrichments (
  id                   bigint generated always as identity primary key,
  article_id           bigint not null references articles (id) on delete cascade,
  url                  text not null,
  status               text not null,
  provider             text,
  model                text,
  infographic_content  jsonb,
  validation           jsonb,
  provenance           jsonb,
  error                text,
  enriched_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (article_id)
);

create index if not exists article_enrichments_status_idx on article_enrichments (status);

-- Per-stage task control: what phase an article is in, why it stopped, and
-- when it's eligible for retry. One row per (article, stage). 'done'/'skipped'
-- clear attempts/last_error/next_retry_at; 'failed' increments attempts and
-- schedules a retry with linear backoff (see pipeline-status.js).
create table if not exists article_pipeline_status (
  id            bigint generated always as identity primary key,
  article_id    bigint not null references articles (id) on delete cascade,
  stage         text not null,
  status        text not null,
  attempts      integer not null default 0,
  last_error    text,
  next_retry_at timestamptz,
  updated_at    timestamptz not null default now(),
  unique (article_id, stage)
);

create index if not exists article_pipeline_status_lookup_idx
  on article_pipeline_status (stage, status, next_retry_at);

-- ---------------------------------------------------------------------------
-- LLM control plane: which provider/keys exist, which models they expose, and
-- which model runs which pipeline task. Managed from the factory UI; read by
-- src/core/llm-registry.js. When these tables are empty (or no DATABASE_URL is
-- set) every LLM caller falls back to its hard-coded env-based chain, so the
-- crawl keeps working exactly as before.
-- ---------------------------------------------------------------------------

-- One row per API endpoint + credential pair.
-- api_style is always 'openai': POST {base_url}/v1/chat/completions with a
-- Bearer header. The column is kept (rather than dropped) so existing rows and
-- queries stay valid, but it now has exactly one legal value.
create table if not exists llm_providers (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  api_style   text not null default 'openai',
  base_url    text not null,
  api_key     text not null,
  enabled     boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The Anthropic request shape was removed from the codebase; every endpoint is
-- now called as OpenAI chat-completions. Flip the default and any rows left
-- over from the two-style era, so a pre-existing provider keeps resolving
-- instead of routing to a shape nothing implements any more. Base URLs pointing
-- at an Anthropic-only endpoint still need repointing by hand.
alter table llm_providers alter column api_style set default 'openai';
update llm_providers set api_style = 'openai', updated_at = now() where api_style <> 'openai';

-- Models a provider exposes. `model` is the exact id sent in the request body.
create table if not exists llm_models (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references llm_providers (id) on delete cascade,
  model       text not null,
  label       text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (provider_id, model)
);

create index if not exists llm_models_provider_idx on llm_models (provider_id);

-- Ordered fallback chain per task. position 0 is tried first; on failure the
-- caller falls through to position 1, and so on.
-- task: 'distill' | 'tag' | 'enrich'
create table if not exists llm_task_routes (
  id          bigint generated always as identity primary key,
  task        text not null,
  position    integer not null,
  model_id    bigint not null references llm_models (id) on delete cascade,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  unique (task, position)
);

create index if not exists llm_task_routes_task_idx on llm_task_routes (task, position);
