#!/usr/bin/env node
// Enrichment pass: runs the async LLM stages (distill then tag) over every
// article whose pipeline row is 'pending' or 'failed' and past its backoff.
// This is the off-the-crawl-path enrichment (fix plan P1): the fetch stage
// only extracts + persists with pending stages; this CLI fills in dedup_title
// (distill) and tags (tag) later, so a slow/dead LLM key never fails a crawl.
//
//   npm run enrich            # both stages, default limit
//   node src/enrich-cli.js --stage tag --limit 50
import { retryFailedStages } from './core/retry-pipeline.js';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--stage') opts.stage = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
  }
  return opts;
}

const { stage, limit } = parseArgs(process.argv.slice(2));

retryFailedStages({ stage, ...(Number.isFinite(limit) ? { limit } : {}) })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
