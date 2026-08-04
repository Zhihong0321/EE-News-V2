// Builds the AI DAILY REPORT card.
//
// The output is the handoff artifact for the HTML/slide/video stage, so its
// structure is deliberately regular: YAML frontmatter carries the machine-
// readable summary (a renderer should read that, not scrape the prose), and each
// story is a fixed-shape block that maps 1:1 onto a slide.
import fs from 'node:fs/promises';
import path from 'node:path';
import { radarConfig } from './config.js';

const SECTIONS = [
  { key: 'model_release', title: 'Model Releases', emoji: '🚀' },
  { key: 'product', title: 'Product & Launches', emoji: '📦' },
  { key: 'research', title: 'Research', emoji: '🔬' },
  { key: 'funding', title: 'Funding & Business', emoji: '💰' },
  { key: 'policy', title: 'Policy & Regulation', emoji: '⚖️' },
  { key: 'guide', title: 'Guides & Documentation', emoji: '📘' },
  { key: 'other', title: 'Also Noted', emoji: '📌' }
];

const TOP_STORY_COUNT = 5;

export function buildReport({ items, health, since, generatedAt, stats }) {
  const date = generatedAt.slice(0, 10);
  const top = pickTopStories(items);
  const bySection = groupBySignal(items);
  const entities = [...new Set(items.map((i) => i.entityName))];

  const lines = [];

  // --- Frontmatter: the renderer's contract -------------------------------
  lines.push('---');
  lines.push(`title: "AI Daily Report — ${date}"`);
  lines.push(`date: ${date}`);
  lines.push(`generated_at: ${generatedAt}`);
  lines.push(`window_start: ${since}`);
  lines.push(`story_count: ${items.length}`);
  lines.push(`entity_count: ${entities.length}`);
  // 'seeded' is a successful poll too — it fetched and parsed, it just also
  // established a baseline. Counting only 'ok' reported 0 healthy sources on a
  // first run, which read like a total failure.
  lines.push(`sources_ok: ${health.filter((h) => ['ok', 'seeded'].includes(h.status)).length}`);
  lines.push(`sources_unchanged: ${health.filter((h) => h.status === 'not_modified').length}`);
  lines.push(`sources_failed: ${health.filter((h) => ['error', 'blocked'].includes(h.status)).length}`);
  if (stats) lines.push(`off_topic_filtered: ${health.reduce((sum, h) => sum + (h.offTopic || 0), 0)}`);
  lines.push('headline_slugs:');
  for (const item of top) lines.push(`  - ${JSON.stringify(item.title || item.url)}`);
  lines.push('---');
  lines.push('');

  // --- Cover slide --------------------------------------------------------
  lines.push(`# AI Daily Report`);
  lines.push('');
  lines.push(`**${formatLongDate(date)}** · ${items.length} stories · ${entities.length} organizations`);
  lines.push('');

  if (!items.length) {
    lines.push('> No new items in this window.');
    lines.push('>');
    lines.push('> On a first run this is expected: each source seeds its baseline so the');
    lines.push('> back catalogue is not reported as breaking news. Run again after the');
    lines.push('> next publish cycle.');
    lines.push('');
    lines.push(renderHealth(health));
    return lines.join('\n');
  }

  // --- Top stories --------------------------------------------------------
  lines.push('## Top Stories');
  lines.push('');
  top.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title || 'Untitled'}`);
    lines.push('');
    lines.push(`**${item.entityName}**${item.country ? ` · ${item.country}` : ''} · ${labelFor(item.signalType)} · score ${item.score}`);
    lines.push('');
    if (item.summary) {
      lines.push(`> ${truncate(item.summary, 320)}`);
      lines.push('');
    }
    lines.push(`[Source](${item.url})${item.discussionUrl ? ` · [Discussion](${item.discussionUrl})` : ''}`);
    if (item.citations?.length) {
      lines.push('');
      lines.push(`_Also reported by: ${item.citations.map((c) => `[${c.entity}](${c.url})`).join(' · ')}_`);
    }
    lines.push('');
  });

  // --- Sectioned detail ---------------------------------------------------
  for (const section of SECTIONS) {
    const sectionItems = (bySection[section.key] || []).filter((i) => !top.includes(i));
    if (!sectionItems.length) continue;

    lines.push(`## ${section.emoji} ${section.title}`);
    lines.push('');
    for (const item of sectionItems) {
      const when = item.publishedAt ? ` _(${formatTime(item.publishedAt)})_` : '';
      const corroboration = item.clusterSize > 1 ? ` **(${item.clusterSize} sources)**` : '';
      lines.push(`- **${item.entityName}** — [${item.title || item.url}](${item.url})${when}${corroboration}`);
      if (item.summary) lines.push(`  ${truncate(item.summary, 180)}`);
    }
    lines.push('');
  }

  // --- Coverage by organization ------------------------------------------
  lines.push('## Coverage by Organization');
  lines.push('');
  lines.push('| Organization | Stories | Signals |');
  lines.push('|---|---|---|');
  for (const [name, group] of groupByEntity(items)) {
    const signals = [...new Set(group.map((i) => labelFor(i.signalType)))].join(', ');
    lines.push(`| ${name} | ${group.length} | ${signals} |`);
  }
  lines.push('');

  lines.push(renderHealth(health));

  return lines.join('\n');
}

function renderHealth(health) {
  const lines = [];
  const ok = health.filter((h) => h.status === 'ok');
  const unchanged = health.filter((h) => h.status === 'not_modified');
  const seeded = health.filter((h) => h.status === 'seeded');
  const failed = health.filter((h) => ['error', 'blocked'].includes(h.status));

  lines.push('---');
  lines.push('');
  lines.push('## Source Health');
  lines.push('');
  lines.push(`${ok.length} returned items · ${unchanged.length} unchanged (304) · ${seeded.length} seeded · ${failed.length} failed`);
  lines.push('');

  if (failed.length) {
    lines.push('| Source | Channel | Problem |');
    lines.push('|---|---|---|');
    for (const row of failed) {
      lines.push(`| ${row.entity} | ${row.kind} | ${row.status === 'blocked' ? '**blocked (403)**' : truncate(row.detail || 'error', 90)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Top stories should survey the day, not showcase whichever org published most.
// Without a cap, one busy newsroom takes every headline slot — the first run had
// OpenAI in 4 of 5 — and a quieter but more significant release gets buried.
function pickTopStories(items, limit = TOP_STORY_COUNT, maxPerEntity = 2) {
  const chosen = [];
  const counts = new Map();

  for (const item of items) {
    if (chosen.length >= limit) break;
    const used = counts.get(item.entitySlug) || 0;
    if (used >= maxPerEntity) continue;
    chosen.push(item);
    counts.set(item.entitySlug, used + 1);
  }

  // If diversity capping left slots empty, backfill by score.
  for (const item of items) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(item)) chosen.push(item);
  }
  return chosen;
}

function groupBySignal(items) {
  const groups = {};
  for (const item of items) {
    const key = SECTIONS.some((s) => s.key === item.signalType) ? item.signalType : 'other';
    (groups[key] ||= []).push(item);
  }
  return groups;
}

function groupByEntity(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.entityName)) groups.set(item.entityName, []);
    groups.get(item.entityName).push(item);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
}

function labelFor(signalType) {
  const found = SECTIONS.find((s) => s.key === signalType);
  return found ? found.title.replace(/ &.*$/, '') : 'Other';
}

function truncate(value, max) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatLongDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

function formatTime(iso) {
  return new Date(iso).toISOString().slice(11, 16) + ' UTC';
}

// The day's accumulated items, newest run merged into whatever earlier runs
// found. This is what makes the radar and the daily report compatible: the
// collector only ever returns items it has not seen before, so a second run in
// the same day legitimately returns nothing — and writing that directly would
// replace a full report with an empty one.
export async function mergeWithExistingDay(items, date) {
  const jsonPath = path.join(radarConfig.outputDir, `ai-daily-${date}.json`);

  let previous = [];
  try {
    previous = JSON.parse(await fs.readFile(jsonPath, 'utf8')).items || [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const byUrl = new Map();
  for (const item of [...previous, ...items]) {
    const existing = byUrl.get(item.url);
    // A later run may have better corroboration, so keep the stronger record.
    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) byUrl.set(item.url, item);
  }

  return [...byUrl.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export async function writeReport(report, { items, generatedAt }, video = null) {
  const date = generatedAt.slice(0, 10);
  await fs.mkdir(radarConfig.outputDir, { recursive: true });

  const mdPath = path.join(radarConfig.outputDir, `ai-daily-${date}.md`);
  const jsonPath = path.join(radarConfig.outputDir, `ai-daily-${date}.json`);

  await fs.writeFile(mdPath, `${report}\n`, 'utf8');
  // JSON alongside MD: the slide/video stage should consume structured data
  // rather than re-parsing markdown.
  await fs.writeFile(jsonPath, `${JSON.stringify({ generatedAt, items }, null, 2)}\n`, 'utf8');

  const paths = { mdPath, jsonPath };

  if (video) {
    // The broadcast cut is a separate artifact, not a replacement: the full
    // report stays authoritative, the script is the distilled read-out.
    paths.videoMdPath = path.join(radarConfig.outputDir, `ai-daily-${date}.video.md`);
    paths.videoJsonPath = path.join(radarConfig.outputDir, `ai-daily-${date}.video.json`);
    await fs.writeFile(paths.videoMdPath, `${video.markdown}\n`, 'utf8');
    await fs.writeFile(paths.videoJsonPath, `${JSON.stringify(video.script, null, 2)}\n`, 'utf8');
  }

  return paths;
}
