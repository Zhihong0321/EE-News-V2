#!/usr/bin/env node
// One-command news pipeline: fetch -> enrich -> render.
//
// Usage:
//   node src/pipeline-cli.js <siteId> [--provider openai|cavoti] [--model id]
//                                     [--no-enrich] [--no-render]
//                                     [--enrich-limit N] [--concurrency N] [--since YYYY-MM-DD]
//
// Examples:
//   node src/pipeline-cli.js sinchew                 # fetch + enrich + render
//   node src/pipeline-cli.js thestar --provider cavoti
//   node src/pipeline-cli.js utusan --no-render      # fetch + enrich only
import { loadEnv } from './config/env.js';
import { getAdapter } from './sites/index.js';
import { getCustomAdapter } from './sites/custom-registry.js';
import { runPipeline } from './core/pipeline.js';

loadEnv();

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    flags[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return { flags, positional };
}

async function resolveAdapter(id) {
  try {
    return getAdapter(id);
  } catch {
    const custom = await getCustomAdapter(id);
    if (!custom) throw new Error(`Unknown site "${id}"`);
    return custom;
  }
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const siteId = positional[0];
if (!siteId) {
  console.error('Usage: node src/pipeline-cli.js <siteId> [--provider openai|cavoti] [--model id] [--no-enrich] [--no-render] [--enrich-limit N] [--concurrency N] [--since YYYY-MM-DD]');
  process.exit(1);
}

const toInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

resolveAdapter(siteId)
  .then((adapter) => runPipeline(adapter, {
    provider: typeof flags.provider === 'string' ? flags.provider : 'openai',
    model: typeof flags.model === 'string' ? flags.model : undefined,
    enrich: !flags['no-enrich'],
    render: !flags['no-render'],
    enrichLimit: toInt(flags['enrich-limit']),
    concurrency: toInt(flags.concurrency) || 1,
    since: typeof flags.since === 'string' ? flags.since : undefined
  }))
  .then((out) => {
    console.log(JSON.stringify({
      site: siteId,
      fetched: out.fetch?.result?.articles?.length ?? 0,
      output: out.fetch?.outputPath ?? null,
      enrichedPacket: out.enrich?.outputPath ?? null,
      enriched: out.enrich?.packet?.count ?? 0,
      rendered: out.render?.rendered?.length ?? 0
    }, null, 2));
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
