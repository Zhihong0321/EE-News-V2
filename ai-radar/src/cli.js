#!/usr/bin/env node
// AI-RADAR pipeline entry point.
//
//   node ai-radar/src/cli.js                  poll hot+warm, write today's report
//   node ai-radar/src/cli.js --tier hot       hot sources only
//   node ai-radar/src/cli.js --tier cold      everything, including arXiv
//   node ai-radar/src/cli.js --hours 48       widen the window
//   node ai-radar/src/cli.js --only deepseek  one entity
//   node ai-radar/src/cli.js --dry-run        collect and print, write nothing
import { loadWatchlist, selectSources, explainSkipped } from './registry.js';
import { collect } from './collect.js';
import { buildReport, writeReport, mergeWithExistingDay } from './report.js';
import { buildVideoScript, renderVideoScript } from './video.js';
import { radarConfig } from './config.js';

function parseArgs(argv) {
  const args = {
    tier: 'warm', hours: radarConfig.windowHours, only: null, dryRun: false,
    stories: 6, minScore: 55
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tier') args.tier = argv[++i];
    else if (arg === '--hours') args.hours = Number(argv[++i]);
    else if (arg === '--only') args.only = argv[++i];
    else if (arg === '--stories') args.stories = Number(argv[++i]);
    else if (arg === '--min-score') args.minScore = Number(argv[++i]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`
AI-RADAR — collect AI industry news and write the daily report card.

  --tier <hot|warm|cold>  how deep to poll (default: warm = hot + warm)
  --hours <n>             reporting window in hours (default: ${radarConfig.windowHours})
  --only <entity-slug>    restrict to one entity, e.g. --only anthropic
  --stories <n>           stories in the video cut (default: 6)
  --min-score <n>         newsworthiness bar for the video cut (default: 55)
  --dry-run               collect and summarize, write no files
  --help                  this message
`.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (!['hot', 'warm', 'cold'].includes(args.tier)) {
    throw new Error(`--tier must be hot, warm or cold (got "${args.tier}")`);
  }
  if (!Number.isFinite(args.hours) || args.hours <= 0) {
    throw new Error(`--hours must be a positive number (got "${args.hours}")`);
  }

  const now = new Date();
  const since = new Date(now.getTime() - args.hours * 3_600_000).toISOString();

  const { sources } = await loadWatchlist();
  const selected = selectSources(sources, { maxTier: args.tier, only: args.only });

  if (!selected.length) {
    throw new Error(args.only
      ? `No pollable sources for entity "${args.only}".`
      : 'No pollable sources selected.');
  }

  console.log(`AI-RADAR: polling ${selected.length} sources (tier<=${args.tier}, window ${args.hours}h)`);

  const result = await collect(selected, { since, now });

  const failed = result.health.filter((h) => ['error', 'blocked'].includes(h.status));
  console.log(
    `collected ${result.items.length} new items · `
    + `${result.health.filter((h) => h.status === 'ok').length} ok · `
    + `${result.health.filter((h) => h.status === 'not_modified').length} unchanged · `
    + `${result.health.filter((h) => h.status === 'seeded').length} seeded · `
    + `${failed.length} failed`
  );
  for (const row of failed) {
    console.log(`  ! ${row.entity} [${row.kind}] ${row.status}: ${row.detail || ''}`);
  }

  const skipped = explainSkipped(sources);
  if (skipped.length) {
    console.log(`note: ${skipped.length} channels are not automated (see report / PLAN.md §10a)`);
  }

  if (args.dryRun) {
    console.log('\n--- dry run, nothing written ---\n');
    console.log(buildReport(result));
    return;
  }

  // Merge into the day's accumulated set before rendering. The collector
  // returns only unseen items, so a later run in the same day would otherwise
  // publish an empty report over a full one.
  const date = result.generatedAt.slice(0, 10);
  const dayItems = await mergeWithExistingDay(result.items, date);
  console.log(`report covers ${dayItems.length} stories for ${date} (${result.items.length} added this run)`);

  const report = buildReport({ ...result, items: dayItems });

  const script = buildVideoScript({ ...result, items: dayItems }, {
    maxStories: args.stories,
    minScore: args.minScore
  });
  const video = { script, markdown: renderVideoScript(script) };
  console.log(
    `video cut: ${script.storyCount} stories · ~${script.totalDurationSec}s runtime`
    + ` (from ${dayItems.length})`
  );

  const { mdPath, jsonPath, videoMdPath, videoJsonPath } =
    await writeReport(report, { ...result, items: dayItems }, video);
  console.log(`\nreport:      ${mdPath}`);
  console.log(`data:        ${jsonPath}`);
  console.log(`video script: ${videoMdPath}`);
  console.log(`video data:   ${videoJsonPath}`);
}

main().catch((error) => {
  console.error(`AI-RADAR failed: ${error.message}`);
  process.exitCode = 1;
});
