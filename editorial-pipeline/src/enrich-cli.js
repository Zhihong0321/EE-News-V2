#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createCavotiTerraProvider } from './providers/cavoti-terra.js';
import { createOpenAiProvider } from './providers/openai-chat.js';
import { enrichNewsFile, retryFailedEnrichment } from './enrich-news.js';

// Load .env from the repo root and let it OVERRIDE ambient vars, so the file the
// user configured is authoritative (ambient OPENAI_* would otherwise shadow it).
(function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return; // no .env — rely on ambient environment
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
})();

function createProvider(name, flags) {
  if (name === 'cavoti' || name === 'terra' || name === 'luna') {
    return createCavotiTerraProvider({ model: flags.model || 'gpt-5.6-terra' });
  }
  return createOpenAiProvider(flags.model ? { model: flags.model } : {});
}
// NOTE: src/core/enrich-provider.js is the shared twin of this factory (used by
// the fetch->enrich->render orchestrator). Keep the two in sync when adding a
// provider. They are intentionally separate so this CLI stays runnable from
// within editorial-pipeline without importing across into src/core.

function parseArguments(values) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    flags[key] = next && !next.startsWith('--') ? values[++index] : true;
  }
  return { positional, flags };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const { positional, flags } = parseArguments(process.argv.slice(2));
const inputPath = positional[0];

function reportPacket({ outputPath, packet, retried }) {
  if (!packet) {
    console.log(JSON.stringify({ retried: 0, message: 'No enrichment work due for retry.' }, null, 2));
    return;
  }
  console.log(JSON.stringify({
    outputPath,
    model: packet.model,
    requested: packet.requested,
    enriched: packet.count,
    invalid: packet.invalidCount,
    failed: packet.failureCount,
    duplicates: packet.duplicateCount,
    ...(retried != null ? { retried } : {})
  }, null, 2));
  if (packet.invalidCount || packet.failureCount) process.exitCode = 1;
}

if (flags.retry) {
  const provider = createProvider(flags.provider || 'openai', flags);
  retryFailedEnrichment({
    provider,
    outputDirectory: flags.output ? path.resolve(flags.output) : undefined,
    limit: flags.limit ? positiveInteger(flags.limit) : undefined,
    concurrency: positiveInteger(flags.concurrency, 1)
  }).then(reportPacket).catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
} else if (!inputPath) {
  console.error('Usage: enrich-cli.js <crawler-output.json> [--provider openai|cavoti] [--model id] [--output directory] [--limit number] [--concurrency number]');
  console.error('       enrich-cli.js --retry [--provider openai|cavoti] [--limit number]   # re-run articles whose enrich stage last failed');
  process.exitCode = 1;
} else {
  const provider = createProvider(flags.provider || 'openai', flags);
  enrichNewsFile(path.resolve(inputPath), {
    provider,
    outputDirectory: flags.output ? path.resolve(flags.output) : undefined,
    limit: flags.limit ? positiveInteger(flags.limit) : undefined,
    concurrency: positiveInteger(flags.concurrency, 1)
  }).then(reportPacket).catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
