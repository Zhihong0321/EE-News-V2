// Full news pipeline orchestrator: fetch -> enrich -> render.
//
// This is the piece that reconnects the crawl to enrichment and rendering. The
// crawl (runSite) stays deterministic and decoupled — it never imports the LLM
// or editorial code. This orchestrator sits ABOVE it and chains the stages,
// with one hard rule (guiding principle #1): the crawl's success must never
// depend on an LLM. So enrich and render are best-effort — if they throw, we
// log loudly and still return the successful fetch result. Enrichment is not
// lost: the articles are already persisted with `distill/tag: pending`, and the
// editorial packet retry queue picks up anything that failed here.
//
// Editorial-pipeline modules are imported LAZILY (inside the try) so a crawl on
// a machine without the editorial deps, or with editorial disabled, still runs.
import path from 'node:path';
import { runSite } from './runner.js';

/**
 * Fetch one site, then (best-effort) enrich and render its output.
 *
 * @param {object} adapter                 site adapter (from sites/index or custom-registry)
 * @param {object} [opts]
 * @param {string} [opts.outputDirectory]  where the crawl JSON is written
 * @param {string} [opts.editorialOutputDirectory] where packets + rendered HTML land
 * @param {string} [opts.since]            backfill start date
 * @param {number} [opts.articleLimit]     crawl cap
 * @param {boolean} [opts.enrich=true]     run the enrichment stage
 * @param {boolean} [opts.render=true]     run the render stage (requires enrich)
 * @param {string} [opts.provider='agy']   enrichment provider name
 * @param {string} [opts.model]            enrichment model override
 * @param {number} [opts.enrichLimit]      cap articles enriched (undefined = all)
 * @param {number} [opts.concurrency=1]    enrichment concurrency
 * @returns {Promise<{fetch, enrich, render}>} per-stage results (enrich/render null if skipped/failed)
 */
export async function runPipeline(adapter, opts = {}) {
  const {
    outputDirectory,
    editorialOutputDirectory = path.resolve(process.cwd(), 'editorial-pipeline/output'),
    since,
    articleLimit,
    enrich = true,
    render = true,
    provider = 'agy',
    model,
    enrichLimit,
    concurrency = 1
  } = opts;

  // --- Stage 1: fetch (must succeed; its errors propagate) ---
  const fetchResult = await runSite(adapter, { outputDirectory, since, articleLimit });
  const out = { fetch: fetchResult, enrich: null, render: null };

  const articleCount = fetchResult?.result?.articles?.length ?? 0;
  if (!enrich) {
    console.log('[pipeline] enrichment disabled — stopping after fetch.');
    return out;
  }
  if (articleCount === 0) {
    console.log('[pipeline] no articles fetched — nothing to enrich.');
    return out;
  }

  // --- Stage 2: enrich (best-effort — never fails the pipeline) ---
  let packetPath = null;
  try {
    const { createProviderForTask } = await import('./enrich-provider.js');
    const { enrichNewsFile } = await import('../../editorial-pipeline/src/enrich-news.js');
    // Honours the factory's 'enrich' chain; `provider` is the fallback when the
    // factory has nothing configured.
    const enrichProvider = await createProviderForTask(provider, { model });
    console.log(`[pipeline] enriching ${articleCount} article(s) via provider "${provider}"...`);
    const enriched = await enrichNewsFile(fetchResult.outputPath, {
      provider: enrichProvider,
      outputDirectory: editorialOutputDirectory,
      limit: Number.isInteger(enrichLimit) && enrichLimit > 0 ? enrichLimit : undefined,
      concurrency
    });
    out.enrich = enriched;
    packetPath = enriched?.outputPath || null;
    console.log(`[pipeline] enriched -> ${packetPath} (${enriched?.packet?.count ?? 0} enriched, ${enriched?.packet?.failureCount ?? 0} failed)`);
  } catch (error) {
    console.error(`[pipeline] ENRICH stage failed (fetch is safe, articles persisted as pending): ${error.message}`);
    return out; // no packet -> can't render
  }

  if (!render || !packetPath) {
    if (!render) console.log('[pipeline] render disabled.');
    return out;
  }

  // --- Stage 3: render (best-effort — deterministic, no LLM) ---
  try {
    const { renderInfographicPacket } = await import('../../editorial-pipeline/src/render-infographic.js');
    const rendered = await renderInfographicPacket(packetPath, { outputDirectory: editorialOutputDirectory });
    out.render = rendered;
    console.log(`[pipeline] rendered ${rendered?.rendered?.length ?? 0} infographic(s), ${rendered?.failures?.length ?? 0} failure(s).`);
  } catch (error) {
    console.error(`[pipeline] RENDER stage failed (fetch + enrich are safe): ${error.message}`);
  }

  return out;
}
