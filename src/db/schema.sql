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
