// "Finish the unfinished" — drive every already-fetched article the rest of the
// way through the pipeline: seed missing enrich rows, enrich the whole backlog,
// then render every packet produced.
//
// WHY THIS EXISTS: the crawl records distill/tag stages, and a fresh fetch's
// output file is what normally feeds enrichment. But an article already sitting
// in the DB with distill+tag done and NO enrich row ("NOT STARTED") is invisible
// to every existing runner — retryFailedEnrichment only sees pending/failed
// enrich rows. So without this bridge there is no way to finish the backlog.
// This seeds a pending enrich row for each stuck article, then loops the
// editorial retry engine until the backlog is drained, then renders.
import path from 'node:path';

// Lazy imports of editorial-pipeline so a DB-less / editorial-less environment
// still loads this module.
export async function finishBacklog({
  provider = 'agy',
  model,
  editorialOutputDirectory = path.resolve(process.cwd(), 'editorial-pipeline/output'),
  concurrency = 1,
  batchSize = 20,
  maxBatches = 50,
  render = true
} = {}) {
  const { isDbEnabled, seedMissingStage } = await import('../db/store.js');
  if (!isDbEnabled()) throw new Error('Finishing the backlog requires a database (set DATABASE_URL).');

  // 1) Seed a pending 'enrich' row for every article that has finished 'tag'
  //    but has no enrich row yet. These are the "NOT STARTED" rows in the UI.
  const seeded = await seedMissingStage('enrich', { requirePriorStage: 'tag' });
  console.log(`[backlog] seeded ${seeded} missing enrich row(s).`);

  // 2) Drain the enrich backlog in batches via the editorial retry engine.
  const { createProvider } = await import('./enrich-provider.js');
  const { retryFailedEnrichment } = await import('../../editorial-pipeline/src/enrich-news.js');
  const enrichProvider = createProvider(provider, { model });

  const packetPaths = [];
  let totalRetried = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await retryFailedEnrichment({
      provider: enrichProvider,
      outputDirectory: editorialOutputDirectory,
      limit: batchSize,
      concurrency
    });
    if (!result || result.retried === 0) break; // backlog drained
    totalRetried += result.retried;
    if (result.outputPath) packetPaths.push(result.outputPath);
    console.log(`[backlog] enrich batch ${batch + 1}: ${result.retried} article(s) -> ${result.outputPath || '(no packet)'} (${result.packet?.count ?? 0} enriched, ${result.packet?.failureCount ?? 0} failed)`);
  }
  console.log(`[backlog] enrichment complete: ${totalRetried} article(s) across ${packetPaths.length} packet(s).`);

  // 3) Render every packet produced (deterministic; best-effort per packet).
  let renderedCount = 0;
  const renderFailures = [];
  if (render && packetPaths.length) {
    const { renderInfographicPacket } = await import('../../editorial-pipeline/src/render-infographic.js');
    for (const packetPath of packetPaths) {
      try {
        const r = await renderInfographicPacket(packetPath, { outputDirectory: editorialOutputDirectory });
        renderedCount += r?.rendered?.length ?? 0;
        if (r?.failures?.length) renderFailures.push(...r.failures);
      } catch (error) {
        console.error(`[backlog] render failed for ${packetPath}: ${error.message}`);
        renderFailures.push({ packet: packetPath, error: error.message });
      }
    }
    console.log(`[backlog] rendered ${renderedCount} infographic(s), ${renderFailures.length} failure(s).`);
  }

  return { seeded, enriched: totalRetried, packets: packetPaths.length, rendered: renderedCount, renderFailures };
}
