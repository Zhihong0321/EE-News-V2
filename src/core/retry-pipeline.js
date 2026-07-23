import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getRetryableWork,
  recordStageStatus,
  updateDedupTitle,
  persistArticles,
  findDuplicateCandidates,
  persistEnrichmentPacket,
  getEnrichmentForArticle,
  isDbEnabled
} from '../db/store.js';
import { generateDigest } from './distill.js';
import { generateTags } from './tagger.js';
import { findDuplicate } from './dedupe.js';
import { createProvider } from './enrich-provider.js';
import { buildEnrichmentPrompt } from '../../editorial-pipeline/src/enrichment-prompt.js';
import { validateEnrichment } from '../../editorial-pipeline/src/enrichment-validator.js';
import { renderInfographicDocument } from '../../editorial-pipeline/templates/infographic/render.js';
import { sha256 } from '../../editorial-pipeline/src/utils.js';

/**
 * Per-stage re-run handlers keyed by pipeline stage name. Each receives the
 * full article row (from getRetryableWork — carries title, body, url, country,
 * ...) and redoes that stage's work, throwing on failure. Registering all five
 * stages allows any unfinished or failed stage row (including NOT STARTED) to
 * be retryable and advanceable from the UI button or CLI.
 */
const EDITORIAL_OUTPUT_DIR = path.resolve(process.cwd(), 'editorial-pipeline/output');

const STAGE_HANDLERS = {
  async distill(article) {
    const dedupTitle = await generateDigest(article);
    await updateDedupTitle(article.id, dedupTitle);
  },

  async tag(article) {
    const tags = await generateTags(article);
    await persistArticles([{ ...article, tags }]);
  },

  async dedup(article) {
    const candidates = await findDuplicateCandidates(article);
    const duplicate = findDuplicate(article, candidates);
    if (duplicate) {
      await recordStageStatus(article.id, 'enrich', 'skipped');
      await recordStageStatus(article.id, 'render', 'skipped');
    }
  },

  async enrich(article) {
    const prompt = buildEnrichmentPrompt(article);
    const provider = createProvider(process.env.ENRICH_PROVIDER || 'agy');
    const response = await provider.enrich(prompt, article);
    const validation = validateEnrichment(article, response.content);
    if (!validation.valid) {
      throw new Error(`Enrichment validation failed: ${validation.errors?.join('; ') || 'invalid output'}`);
    }
    const packet = {
      schemaVersion: 1,
      artifactType: 'infographic-content',
      sourceFile: `retry:enrich:${article.id}`,
      source: article.source,
      fetchedAt: article.fetched_at,
      enrichedAt: new Date().toISOString(),
      model: provider.id,
      requested: 1,
      count: 1,
      invalidCount: 0,
      failureCount: 0,
      duplicateCount: 0,
      failures: [],
      duplicates: [],
      articles: [{
        status: 'enriched',
        coreNews: article,
        infographicContent: response.content,
        validation,
        provenance: {
          ...response.provenance,
          promptHash: sha256(prompt),
          elapsedMs: 0
        }
      }]
    };
    await persistEnrichmentPacket(packet);

    await fs.mkdir(EDITORIAL_OUTPUT_DIR, { recursive: true });
    const packetPath = path.join(EDITORIAL_OUTPUT_DIR, `infographic_${article.id}.json`);
    await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  },

  async render(article) {
    const enrichment = await getEnrichmentForArticle(article.id);
    if (!enrichment || enrichment.status !== 'enriched' || !enrichment.infographic_content) {
      throw new Error(`No usable enrichment for article id ${article.id} (status: ${enrichment?.status ?? 'none'}) — enrich must succeed before render`);
    }
    const infographicContent = typeof enrichment.infographic_content === 'string'
      ? JSON.parse(enrichment.infographic_content)
      : enrichment.infographic_content;
    const entry = {
      status: 'enriched',
      coreNews: article,
      infographicContent
    };

    await fs.mkdir(EDITORIAL_OUTPUT_DIR, { recursive: true });

    // Write packet JSON first so it exists and mtime is <= render HTML mtime
    const packet = {
      schemaVersion: 1,
      artifactType: 'infographic-content',
      sourceFile: `retry:render:${article.id}`,
      source: article.source,
      fetchedAt: article.fetched_at,
      enrichedAt: new Date().toISOString(),
      model: enrichment.model || 'unknown',
      requested: 1,
      count: 1,
      invalidCount: 0,
      failureCount: 0,
      duplicateCount: 0,
      failures: [],
      duplicates: [],
      articles: [entry]
    };
    const packetPath = path.join(EDITORIAL_OUTPUT_DIR, `infographic_${article.id}.json`);
    await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');

    // Copy support.js if not present
    const supportJsSource = path.resolve(process.cwd(), 'editorial-pipeline/templates/infographic/support.js');
    const supportJsTarget = path.join(EDITORIAL_OUTPUT_DIR, 'support.js');
    try {
      await fs.copyFile(supportJsSource, supportJsTarget);
    } catch {}

    const html = renderInfographicDocument(entry);
    const fileName = `infographic_${article.id}.dc.html`;
    await fs.writeFile(path.join(EDITORIAL_OUTPUT_DIR, fileName), html, 'utf8');
  }
};

/** Stage names that have a registered retry handler, in pipeline execution order. */
export function retryableStages() {
  return ['distill', 'tag', 'dedup', 'enrich', 'render'];
}

async function retryStage(stage, handler, limit) {
  const articles = await getRetryableWork(stage, { limit });
  let succeeded = 0;
  let failed = 0;
  for (const article of articles) {
    try {
      await recordStageStatus(article.id, stage, 'pending');
      await handler(article);
      await recordStageStatus(article.id, stage, 'done');
      succeeded += 1;
    } catch (error) {
      await recordStageStatus(article.id, stage, 'failed', error.message);
      console.warn(`Retry ${stage} failed for ${article.url}: ${error.message}`);
      failed += 1;
    }
  }
  return { stage, attempted: articles.length, succeeded, failed };
}

/**
 * Re-run every unfinished row for one pipeline stage, or for all 5 stages in order
 * (`distill → tag → dedup → enrich → render`) when `stage` is omitted.
 */
export async function retryFailedStages({ stage, limit = 20 } = {}) {
  if (!isDbEnabled()) throw new Error('No database configured — retry mode requires DATABASE_URL (or SUPABASE_DB_URL)');
  const stages = stage ? [stage] : retryableStages();
  const results = [];
  for (const name of stages) {
    const handler = STAGE_HANDLERS[name];
    if (!handler) throw new Error(`No retry handler registered for stage "${name}"`);
    results.push(await retryStage(name, handler, limit));
  }
  const totals = results.reduce(
    (acc, result) => ({
      attempted: acc.attempted + result.attempted,
      succeeded: acc.succeeded + result.succeeded,
      failed: acc.failed + result.failed
    }),
    { attempted: 0, succeeded: 0, failed: 0 }
  );
  return { ...totals, stages: results };
}
