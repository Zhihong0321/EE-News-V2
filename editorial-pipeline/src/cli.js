#!/usr/bin/env node
import path from 'node:path';
import { createResearchBench, defaultOutputDirectory } from './index.js';

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
    const flagValue = next && !next.startsWith('--') ? values[++index] : true;
    if (flags[key] === undefined) flags[key] = flagValue;
    else flags[key] = Array.isArray(flags[key]) ? [...flags[key], flagValue] : [flags[key], flagValue];
  }
  return { positional, flags };
}

function numberFlag(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArguments(rest);
  const bench = createResearchBench();

  if (command === 'search') {
    const query = positional.join(' ');
    console.log(JSON.stringify(await bench.searchWeb(query, { limit: numberFlag(flags.limit, 10) }), null, 2));
    return;
  }

  if (command === 'fetch') {
    const document = await bench.fetchPage(positional[0], { date: flags.date });
    console.log(JSON.stringify(document, null, 2));
    if (document.failureReason) process.exitCode = 1;
    return;
  }

  if (command === 'research') {
    const question = positional.join(' ');
    const session = bench.createSession(question, {
      budgets: {
        maxRequests: numberFlag(flags.requests, 20),
        maxDocuments: numberFlag(flags.documents, 5),
        maxElapsedMs: numberFlag(flags.timeout, 300000)
      }
    });
    const extraQueries = flags.query ? (Array.isArray(flags.query) ? flags.query : [flags.query]) : [];
    const queries = [question, ...extraQueries];
    for (const query of queries) await session.search(query, { limit: numberFlag(flags.limit, 10) });
    const urls = session.packet.searchResults.slice(0, session.packet.budgets.maxDocuments).map((result) => result.url);
    for (const url of urls) await session.fetch(url);
    const packet = session.complete();
    const outputDirectory = path.resolve(flags.output || defaultOutputDirectory);
    const outputPath = await session.save(outputDirectory);
    console.log(JSON.stringify({ outputPath, packet }, null, 2));
    if (packet.status !== 'complete') process.exitCode = 1;
    return;
  }

  if (command === 'replay') {
    console.log(JSON.stringify(await bench.replay(path.resolve(positional[0])), null, 2));
    return;
  }

  throw new Error('Usage: cli.js <search|fetch|research|replay> [arguments]');
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exitCode = 1;
});
