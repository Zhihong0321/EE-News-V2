import fs from 'node:fs/promises';
import path from 'node:path';
import { buildEnrichmentPrompt } from './enrichment-prompt.js';
import { validateEnrichment } from './enrichment-validator.js';
import { nowIso, sha256 } from './utils.js';
import { findDuplicate } from '../../src/core/dedupe.js';
import { generateTagsAndCountry } from '../../src/core/tagger.js';

export function infographicOutputName(inputPath) {
  return `infographic_${path.basename(inputPath)}`;
}

async function writeJson(outputPath, value) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

// Best-effort: dynamically loaded so the editorial pipeline still runs where
// the db layer/pg dependency is absent. Shared by enrichArticleList (dedup +
// per-stage status) and the enrichNewsFile/retryFailedEnrichment persistence
// steps below.
async function loadDb() {
  try {
    const db = await import('../../src/db/store.js');
    return db.isDbEnabled() ? db : null;
  } catch (error) {
    console.warn(`Database features unavailable: ${error.message}`);
    return null;
  }
}

/**
 * Run the dedup-check-then-enrich worker pool over `articles`, recording
 * per-stage ('dedup', 'enrich') pipeline status when the DB is configured.
 * Returns the raw per-article results plus the status-grouped buckets used
 * to build a packet.
 */
async function enrichArticleList(articles, { provider, concurrency, db, skipDedupe = false }) {
  const results = new Array(articles.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= articles.length) return;
      const article = articles[index];
      const startedAt = Date.now();
      const articleId = db ? await db.getArticleIdByUrl(article.url).catch(() => null) : null;

      if (db && !skipDedupe) {
        try {
          if (articleId) await db.recordStageStatus(articleId, 'dedup', 'pending').catch(() => {});
          const candidates = (await db.findDuplicateCandidates(article) || []).filter((c) => c.url !== article.url);
          const duplicate = findDuplicate(article, candidates);
          if (articleId) await db.recordStageStatus(articleId, 'dedup', 'done').catch(() => {});
          if (duplicate && duplicate.url !== article.url) {
            if (articleId) await db.recordStageStatus(articleId, 'enrich', 'skipped').catch(() => {});
            results[index] = {
              status: 'duplicate',
              coreNews: article,
              duplicateOf: { id: duplicate.id, url: duplicate.url, source: duplicate.source, score: duplicate.score },
              provenance: { elapsedMs: Date.now() - startedAt }
            };
            continue;
          }
        } catch (error) {
          if (articleId) await db.recordStageStatus(articleId, 'dedup', 'failed', error.message).catch(() => {});
          console.warn(`Duplicate check failed for ${article.url}: ${error.message}`);
        }
      }

      try {
        if (articleId && db) await db.recordStageStatus(articleId, 'tag', 'pending').catch(() => {});
        const meta = await generateTagsAndCountry(article);
        if (meta.tags && meta.tags.length > 0) article.tags = meta.tags;
        if (meta.country) article.country = meta.country;
        if (articleId && db) {
          await db.recordStageStatus(articleId, 'tag', 'done').catch(() => {});
          await db.persistArticles([article]).catch(() => {});
        }
      } catch (error) {
        if (articleId && db) await db.recordStageStatus(articleId, 'tag', 'failed', error.message).catch(() => {});
        article.tags = article.tags || [];
      }

      const prompt = buildEnrichmentPrompt(article);
      try {
        if (articleId) await db.recordStageStatus(articleId, 'enrich', 'pending').catch(() => {});
        const response = await provider.enrich(prompt, article);
        const validation = validateEnrichment(article, response.content);
        const status = validation.valid ? 'enriched' : 'invalid';
        if (articleId) {
          const stage = status === 'enriched' ? 'done' : 'failed';
          await db.recordStageStatus(articleId, 'enrich', stage, stage === 'failed' ? 'validation failed' : null).catch(() => {});
        }
        results[index] = {
          status,
          coreNews: article,
          infographicContent: response.content,
          validation,
          provenance: {
            ...response.provenance,
            promptHash: sha256(prompt),
            elapsedMs: Date.now() - startedAt
          }
        };
      } catch (error) {
        if (articleId) await db.recordStageStatus(articleId, 'enrich', 'failed', error.message).catch(() => {});
        results[index] = {
          status: 'failed',
          coreNews: article,
          error: error.message,
          provenance: {
            provider: provider.id,
            promptHash: sha256(prompt),
            elapsedMs: Date.now() - startedAt
          }
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, articles.length) }, () => worker()));
  return {
    results,
    successful: results.filter((result) => result.status === 'enriched'),
    invalid: results.filter((result) => result.status === 'invalid'),
    failed: results.filter((result) => result.status === 'failed'),
    duplicates: results.filter((result) => result.status === 'duplicate')
  };
}

function buildPacket({ sourceFile, source, fetchedAt, model, requested, buckets, clock }) {
  const { results, successful, invalid, failed, duplicates } = buckets;
  return {
    schemaVersion: 1,
    artifactType: 'infographic-content',
    sourceFile,
    source: source || null,
    fetchedAt: fetchedAt || null,
    enrichedAt: nowIso(clock),
    model,
    requested,
    count: successful.length,
    invalidCount: invalid.length,
    failureCount: failed.length,
    duplicateCount: duplicates.length,
    failures: failed.map((result) => ({
      title: result.coreNews.title,
      url: result.coreNews.url,
      reason: result.error
    })),
    duplicates: duplicates.map((result) => ({
      title: result.coreNews.title,
      url: result.coreNews.url,
      duplicateOf: result.duplicateOf
    })),
    articles: results
  };
}

async function persistPacket(packet, db) {
  if (!db) return;
  try {
    const { stored } = await db.persistEnrichmentPacket(packet);
    if (stored > 0) console.log(`Stored ${stored} enrichment record(s) in the database.`);
  } catch (error) {
    console.warn(`Enrichment persistence skipped: ${error.message}`);
  }
}

export async function enrichNewsFile(inputPath, {
  provider,
  outputDirectory,
  limit,
  concurrency = 3,
  skipDedupe = false,
  clock
} = {}) {
  if (!provider?.enrich) throw new Error('An enrichment provider is required');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer');
  const absoluteInputPath = path.resolve(inputPath);
  const input = JSON.parse(await fs.readFile(absoluteInputPath, 'utf8'));
  const available = Array.isArray(input.articles) ? input.articles.filter((article) => article?.title && article?.body && article?.url) : [];
  const articles = Number.isInteger(limit) && limit > 0 ? available.slice(0, limit) : available;
  if (articles.length === 0) throw new Error(`No valid articles found in ${absoluteInputPath}`);

  const db = await loadDb();
  const buckets = await enrichArticleList(articles, { provider, concurrency, db, skipDedupe });
  const packet = buildPacket({
    sourceFile: absoluteInputPath,
    source: input.source,
    fetchedAt: input.fetched_at,
    model: provider.id,
    requested: articles.length,
    buckets,
    clock
  });

  const directory = path.resolve(outputDirectory || path.dirname(absoluteInputPath));
  const outputPath = path.join(directory, infographicOutputName(absoluteInputPath));
  await writeJson(outputPath, packet);
  await persistPacket(packet, db);

  return { outputPath, packet };
}

/**
 * Re-run enrichment for articles whose 'enrich' pipeline stage last failed
 * and are past their retry backoff window (see src/db/pipeline-status.js).
 * Requires the DB (that's where the retry queue lives). Returns
 * { outputPath: null, packet: null, retried: 0 } when there's nothing due.
 */
export async function retryFailedEnrichment({
  provider,
  outputDirectory,
  limit = 20,
  concurrency = 3,
  clock
} = {}) {
  if (!provider?.enrich) throw new Error('An enrichment provider is required');
  const db = await loadDb();
  if (!db) throw new Error('No database configured — retry mode requires DATABASE_URL (or SUPABASE_DB_URL)');

  const articles = await db.getRetryableWork('enrich', { limit });
  if (articles.length === 0) return { outputPath: null, packet: null, retried: 0 };

  const buckets = await enrichArticleList(articles, { provider, concurrency, db });
  const packet = buildPacket({
    sourceFile: 'retry:enrich',
    source: null,
    fetchedAt: null,
    model: provider.id,
    requested: articles.length,
    buckets,
    clock
  });

  const directory = path.resolve(outputDirectory || path.resolve(process.cwd(), 'output'));
  const outputPath = path.join(directory, `infographic_retry-enrich-${Date.now()}.json`);
  await writeJson(outputPath, packet);
  await persistPacket(packet, db);

  return { outputPath, packet, retried: articles.length };
}
