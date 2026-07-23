import { getPool, isDbEnabled, query } from './pool.js';
import {
  recordStageStatusWithClient,
  recordStageStatus,
  getArticleIdByUrl,
  getExistingArticleUrls,
  getRetryableWork,
  getPipelineDashboard,
  seedMissingStage
} from './pipeline-status.js';

export { isDbEnabled, recordStageStatus, getArticleIdByUrl, getExistingArticleUrls, getRetryableWork, getPipelineDashboard, seedMissingStage };

const UPDATE_DEDUP_TITLE = `update articles set dedup_title = $2, updated_at = now() where id = $1;`;

/** Write back a re-generated dedup_title (used by the distill retry job). */
export async function updateDedupTitle(articleId, dedupTitle) {
  if (!isDbEnabled() || !articleId) return;
  await query(UPDATE_DEDUP_TITLE, [articleId, dedupTitle]);
}

const FIND_DUPLICATE_CANDIDATES = `
select id, url, source, dedup_title
from articles
where country = $1
  and dedup_title is not null
  and published_at is not null
  and published_at > now() - interval '48 hours'
  and url <> $2
order by published_at desc
limit 20;
`;

/**
 * Candidate rows for cross-source duplicate detection: same country, last 48
 * hours, excluding the article's own url. Returns [] when the DB is not
 * configured or the article lacks the fields needed to search (country,
 * dedup_title).
 */
export async function findDuplicateCandidates(article) {
  if (!isDbEnabled() || !article?.country || !article?.dedup_title || !article?.url) return [];
  const { rows } = await query(FIND_DUPLICATE_CANDIDATES, [article.country, article.url]);
  return rows;
}

// Two variants: when the caller supplies `tags` (the fetch stage always
// does — dedup_title is generated in the same fetch-stage step), write both.
// When it doesn't (the enrichment stage upserts a bare coreNews object with
// no tags field), leave both columns untouched instead of clobbering values a
// prior fetch already set.
const UPSERT_ARTICLE = `
insert into articles
  (source, country, title, url, published_at, author, section, body, description, fetched_at, tags, dedup_title, updated_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
on conflict (url) do update set
  source       = excluded.source,
  country      = excluded.country,
  title        = excluded.title,
  published_at = excluded.published_at,
  author       = excluded.author,
  section      = excluded.section,
  body         = excluded.body,
  description  = excluded.description,
  fetched_at   = excluded.fetched_at,
  tags         = excluded.tags,
  dedup_title  = excluded.dedup_title,
  updated_at   = now()
returning id, url;
`;

const UPSERT_ARTICLE_KEEP_TAGS = `
insert into articles
  (source, country, title, url, published_at, author, section, body, description, fetched_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
on conflict (url) do update set
  source       = excluded.source,
  country      = excluded.country,
  title        = excluded.title,
  published_at = excluded.published_at,
  author       = excluded.author,
  section      = excluded.section,
  body         = excluded.body,
  description  = excluded.description,
  fetched_at   = excluded.fetched_at,
  updated_at   = now()
returning id, url;
`;

function toTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertArticle(client, article) {
  const params = [
    article.source ?? null,
    article.country ?? null,
    article.title,
    article.url,
    toTimestamp(article.published_at),
    article.author ?? null,
    article.section ?? null,
    article.body ?? null,
    article.description ?? null,
    toTimestamp(article.fetched_at)
  ];
  const { rows } = Array.isArray(article.tags)
    ? await client.query(UPSERT_ARTICLE, [...params, article.tags, article.dedup_title ?? null])
    : await client.query(UPSERT_ARTICLE_KEEP_TAGS, params);
  return rows[0].id;
}

/**
 * Upsert an array of crawler articles into the articles table.
 * Returns a Map of url -> article id. No-op (returns empty map) when the DB is
 * not configured, so callers can stay unconditional.
 */
export async function persistArticles(articles) {
  const idsByUrl = new Map();
  if (!isDbEnabled() || !Array.isArray(articles) || articles.length === 0) return idsByUrl;

  const client = await getPool().connect();
  try {
    await client.query('begin');
    for (const article of articles) {
      if (!article?.title || !article?.url) continue;
      const id = await upsertArticle(client, article);
      idsByUrl.set(article.url, id);
      if (article.dedup_title) {
        await recordStageStatusWithClient(client, id, 'distill', 'done');
      } else if (article.dedup_error) {
        await recordStageStatusWithClient(client, id, 'distill', 'failed', article.dedup_error);
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return idsByUrl;
}

const UPSERT_ENRICHMENT = `
insert into article_enrichments
  (article_id, url, status, provider, model, infographic_content, validation, provenance, error, enriched_at, updated_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
on conflict (article_id) do update set
  status              = excluded.status,
  provider            = excluded.provider,
  model               = excluded.model,
  infographic_content = excluded.infographic_content,
  validation          = excluded.validation,
  provenance          = excluded.provenance,
  error               = excluded.error,
  enriched_at         = now(),
  updated_at          = now();
`;

function asJson(value) {
  return value == null ? null : JSON.stringify(value);
}

/**
 * Persist an enrichment packet (from enrichNewsFile) into article_enrichments.
 * Ensures each underlying article exists first, then links the enrichment by
 * article id. Returns { stored, skipped }. No-op when the DB is not configured.
 */
export async function persistEnrichmentPacket(packet) {
  if (!isDbEnabled() || !packet || !Array.isArray(packet.articles)) return { stored: 0, skipped: 0 };

  const client = await getPool().connect();
  let stored = 0;
  let skipped = 0;
  try {
    await client.query('begin');
    for (const result of packet.articles) {
      const article = result?.coreNews;
      if (!article?.url || !article?.title) {
        skipped += 1;
        continue;
      }
      const articleId = await upsertArticle(client, article);
      await client.query(UPSERT_ENRICHMENT, [
        articleId,
        article.url,
        result.status ?? 'unknown',
        result.provenance?.provider ?? packet.model ?? null,
        packet.model ?? result.provenance?.model ?? null,
        asJson(result.infographicContent),
        asJson(result.validation),
        asJson(result.provenance),
        result.error ?? null
      ]);
      stored += 1;
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { stored, skipped };
}

/**
 * Fetch the latest enrichment record for an article by article ID.
 * Returns null if not found or DB disabled.
 */
export async function getEnrichmentForArticle(articleId) {
  if (!isDbEnabled() || !articleId) return null;
  const { rows } = await query(
    `select infographic_content, status, provider, model from article_enrichments where article_id = $1;`,
    [articleId]
  );
  return rows[0] ?? null;
}

