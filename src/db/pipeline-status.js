import fs from 'node:fs/promises';
import path from 'node:path';
import { isDbEnabled, query } from './pool.js';

const GET_DONE_RENDERS_SQL = `
select a.id, a.source, a.country, a.title, a.url, a.published_at, a.author, a.section, a.body, a.description, a.fetched_at, a.dedup_title, a.tags
from article_pipeline_status s
join articles a on a.id = s.article_id
where s.stage = 'render' and s.status = 'done'
order by a.id desc
limit $1;
`;

async function getDoneRendersMissingFromDisk({ limit = 20 } = {}) {
  if (!isDbEnabled() || limit <= 0) return [];
  const { rows } = await query(GET_DONE_RENDERS_SQL, [limit * 5]);
  const outputDir = path.resolve(process.cwd(), 'editorial-pipeline/output');
  const missing = [];
  for (const row of rows) {
    const htmlFile = path.join(outputDir, `infographic_${row.id}.dc.html`);
    try {
      await fs.stat(htmlFile);
    } catch {
      missing.push(row);
      if (missing.length >= limit) break;
    }
  }
  return missing;
}

export async function getRetryableWork(stage, { limit = 20 } = {}) {
  if (!isDbEnabled() || !stage) return [];
  const priorStage = STAGE_PRIORS[stage];
  let rows = [];
  if (priorStage) {
    const res = await query(GET_RETRYABLE_WORK_WITH_PRIOR_SQL, [stage, priorStage, limit]);
    rows = res.rows;
  } else {
    const res = await query(GET_RETRYABLE_WORK_SQL, [stage, limit]);
    rows = res.rows;
  }

  if (stage === 'render' && rows.length < limit) {
    const missing = await getDoneRendersMissingFromDisk({ limit: limit - rows.length });
    const existingIds = new Set(rows.map((r) => r.id));
    for (const item of missing) {
      if (!existingIds.has(item.id)) {
        rows.push(item);
      }
    }
  }

  return rows;
}

// Linear backoff: 10 minutes per attempt, capped at 6 hours. Simple and
// deterministic — matches the retry style already used by the enrichment
// providers (attempt * fixed delay) rather than exponential.
const RETRY_BACKOFF_CAP_MINUTES = 360;

const RECORD_DONE_SQL = `
insert into article_pipeline_status (article_id, stage, status, attempts, last_error, next_retry_at, updated_at)
values ($1, $2, $3, 0, null, null, now())
on conflict (article_id, stage) do update set
  status        = excluded.status,
  attempts      = 0,
  last_error    = null,
  next_retry_at = null,
  updated_at    = now();
`;

const RECORD_PENDING_SQL = `
insert into article_pipeline_status (article_id, stage, status, attempts, last_error, next_retry_at, updated_at)
values ($1, $2, 'pending', 0, null, null, now())
on conflict (article_id, stage) do update set
  status        = 'pending',
  last_error    = null,
  next_retry_at = null,
  updated_at    = now();
`;

const RECORD_FAILED_SQL = `
insert into article_pipeline_status (article_id, stage, status, attempts, last_error, next_retry_at, updated_at)
values ($1, $2, 'failed', 1, $3, now() + interval '10 minutes', now())
on conflict (article_id, stage) do update set
  status        = 'failed',
  attempts      = article_pipeline_status.attempts + 1,
  last_error    = excluded.last_error,
  next_retry_at = now() + (least((article_pipeline_status.attempts + 1) * 10, ${RETRY_BACKOFF_CAP_MINUTES}) || ' minutes')::interval,
  updated_at    = now();
`;

const GET_ARTICLE_ID_BY_URL_SQL = `select id from articles where url = $1;`;

const GET_EXISTING_URLS_SQL = `select url from articles where url = any($1::text[]);`;

const STAGE_PRIORS = {
  distill: null,
  tag: 'distill',
  dedup: 'tag',
  enrich: 'dedup',
  render: 'enrich'
};

const GET_RETRYABLE_WORK_SQL = `
select a.id, a.source, a.country, a.title, a.url, a.published_at, a.author, a.section, a.body, a.description, a.fetched_at, a.dedup_title, a.tags
from articles a
left join article_pipeline_status s on s.article_id = a.id and s.stage = $1
where (
  s.stage is null
  or (s.status in ('pending', 'failed') and (s.next_retry_at is null or s.next_retry_at <= now()))
)
order by coalesce(s.next_retry_at, a.fetched_at) asc nulls first
limit $2;
`;

const GET_RETRYABLE_WORK_WITH_PRIOR_SQL = `
select a.id, a.source, a.country, a.title, a.url, a.published_at, a.author, a.section, a.body, a.description, a.fetched_at, a.dedup_title, a.tags
from articles a
left join article_pipeline_status s on s.article_id = a.id and s.stage = $1
where (
  s.stage is null
  or (s.status in ('pending', 'failed') and (s.next_retry_at is null or s.next_retry_at <= now()))
)
and exists (
  select 1 from article_pipeline_status p
  where p.article_id = a.id and p.stage = $2 and p.status = 'done'
)
order by coalesce(s.next_retry_at, a.fetched_at) asc nulls first
limit $3;
`;

const GET_PIPELINE_COUNTS_SQL = `
select stage, status, count(*)::integer as count
from article_pipeline_status
group by stage, status
order by stage, status;
`;

const GET_PIPELINE_ARTICLES_SQL = `
select
  a.id,
  a.source,
  a.country,
  a.title,
  a.url,
  a.fetched_at,
  max(s.updated_at) as pipeline_updated_at,
  jsonb_object_agg(
    s.stage,
    jsonb_build_object(
      'status', s.status,
      'attempts', s.attempts,
      'lastError', s.last_error,
      'nextRetryAt', s.next_retry_at,
      'updatedAt', s.updated_at
    )
  ) as stages
from article_pipeline_status s
join articles a on a.id = s.article_id
group by a.id
order by max(s.updated_at) desc
limit $1;
`;

/**
 * Record a pipeline stage outcome for an article (e.g. stage 'distill',
 * status 'pending'/'done'/'failed'/'skipped'). 'failed' increments the attempt
 * count and schedules next_retry_at with backoff; 'pending' preserves attempts;
 * terminal non-failure states clear retry metadata.
 * Runs on the shared pool. No-op when the DB is not configured.
 */
export async function recordStageStatus(articleId, stage, status, error = null) {
  if (!isDbEnabled() || !articleId || !stage || !status) return;
  if (status === 'failed') {
    await query(RECORD_FAILED_SQL, [articleId, stage, error ? String(error).slice(0, 500) : null]);
  } else if (status === 'pending') {
    await query(RECORD_PENDING_SQL, [articleId, stage]);
  } else {
    await query(RECORD_DONE_SQL, [articleId, stage, status]);
  }
}

/** Same as recordStageStatus, but runs on an existing client/transaction. */
export async function recordStageStatusWithClient(client, articleId, stage, status, error = null) {
  if (!articleId || !stage || !status) return;
  if (status === 'failed') {
    await client.query(RECORD_FAILED_SQL, [articleId, stage, error ? String(error).slice(0, 500) : null]);
  } else if (status === 'pending') {
    await client.query(RECORD_PENDING_SQL, [articleId, stage]);
  } else {
    await client.query(RECORD_DONE_SQL, [articleId, stage, status]);
  }
}

/**
 * Resolve an article's DB id from its url. Returns null when the DB is not
 * configured or no matching row exists.
 */
export async function getArticleIdByUrl(url) {
  if (!isDbEnabled() || !url) return null;
  const { rows } = await query(GET_ARTICLE_ID_BY_URL_SQL, [url]);
  return rows[0]?.id ?? null;
}

/**
 * Bulk-check which of `urls` already have an articles row, so callers can
 * skip re-fetching (and re-running Playwright/tagging/distillation for) URLs
 * already stored. Returns an empty Set when the DB is not configured or
 * `urls` is empty.
 */
export async function getExistingArticleUrls(urls) {
  if (!isDbEnabled() || !Array.isArray(urls) || urls.length === 0) return new Set();
  const { rows } = await query(GET_EXISTING_URLS_SQL, [urls]);
  return new Set(rows.map((row) => row.url));
}



// Seed a `pending` row of `stage` for every article that has NO row for that
// stage yet ("NOT STARTED"). This is the bridge that lets already-fetched
// articles enter a later stage: retry/backlog runners only see articles that
// already have a pending/failed row, so without this an article whose stage
// was never started can never be picked up. `requirePriorStage`, when given,
// only seeds articles whose prior stage is already 'done' (e.g. only seed
// 'enrich' for articles that finished 'tag'). Returns the number of rows seeded.
const SEED_MISSING_STAGE_SQL = `
insert into article_pipeline_status (article_id, stage, status, attempts, last_error, next_retry_at, updated_at)
select a.id, $1, 'pending', 0, null, null, now()
from articles a
where not exists (
  select 1 from article_pipeline_status s where s.article_id = a.id and s.stage = $1
)
{{PRIOR}}
on conflict (article_id, stage) do nothing;
`;

export async function seedMissingStage(stage, { requirePriorStage = null } = {}) {
  if (!isDbEnabled() || !stage) return 0;
  const priorClause = requirePriorStage
    ? `and exists (select 1 from article_pipeline_status p where p.article_id = a.id and p.stage = $2 and p.status = 'done')`
    : '';
  const sql = SEED_MISSING_STAGE_SQL.replace('{{PRIOR}}', priorClause);
  const params = requirePriorStage ? [stage, requirePriorStage] : [stage];
  const { rowCount } = await query(sql, params);
  return rowCount;
}

/**
 * Read-only factory view of the latest per-article pipeline state. Returns a
 * disabled payload when no database is configured so the UI can keep showing
 * crawler-process status without treating optional persistence as an error.
 */
export async function getPipelineDashboard({ limit = 80 } = {}) {
  if (!isDbEnabled()) {
    return { enabled: false, counts: [], articles: [] };
  }
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 80;
  const [countsResult, articlesResult] = await Promise.all([
    query(GET_PIPELINE_COUNTS_SQL),
    query(GET_PIPELINE_ARTICLES_SQL, [safeLimit])
  ]);
  return {
    enabled: true,
    counts: countsResult.rows,
    articles: articlesResult.rows
  };
}
