#!/usr/bin/env node
// Finish every unfinished article: seed missing enrich rows, enrich the whole
// backlog, render every packet. This is the "finish the unfinished" button as a
// command line.
//
// Usage:
//   node src/finish-cli.js [--provider agy|anthropic|cavoti] [--model id]
//                          [--batch N] [--concurrency N] [--no-render]
import { loadEnv } from './config/env.js';
import { finishBacklog } from './core/finish-backlog.js';

loadEnv();

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    flags[key] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const toInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

finishBacklog({
  provider: typeof flags.provider === 'string' ? flags.provider : 'agy',
  model: typeof flags.model === 'string' ? flags.model : undefined,
  concurrency: toInt(flags.concurrency) || 1,
  batchSize: toInt(flags.batch) || 20,
  render: !flags['no-render']
})
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
