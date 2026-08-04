// Loads watchlist.json and flattens it into the list of sources a run will poll.
//
// The watchlist is data, not code: adding a lab is a JSON edit. This module is
// the only place that knows the file's shape, and it validates rather than
// trusting it — a typo in a `kind` should fail loudly at startup, not silently
// poll nothing.
import fs from 'node:fs/promises';
import { radarConfig } from './config.js';

export const CHANNEL_KINDS = new Set([
  'rss',
  'sitemap',
  'github_releases',
  'hf_models',
  'json_api',
  'html',
  'x_syndication'
]);

// Only these are wired up for automated collection. `html` needs Playwright and
// `x_syndication` needs a tweet-ID discovery step; both are deliberately out of
// the v1 pipeline (see PLAN.md §10a).
export const COLLECTABLE_KINDS = new Set([
  'rss',
  'sitemap',
  'github_releases',
  'hf_models',
  'json_api'
]);

// A source must be in one of these states to be polled. `needs_adapter`,
// `broken`, `dropped` and `excluded_by_robots` are all skipped by design.
const POLLABLE_STATUSES = new Set(['verified', 'mechanism_verified']);

const TIER_ORDER = ['hot', 'warm', 'cold'];

export async function loadWatchlist(watchlistPath = radarConfig.watchlistPath) {
  const raw = await fs.readFile(watchlistPath, 'utf8');
  const parsed = JSON.parse(raw);

  const owners = [
    ...(parsed.entities || []).map((e) => ({ ...e, group: 'entity' })),
    ...(parsed.aggregators || []).map((a) => ({ ...a, group: 'aggregator' }))
  ];

  const sources = [];
  const problems = [];

  for (const owner of owners) {
    if (owner.enabled === false) continue;
    for (const source of owner.sources || []) {
      if (!CHANNEL_KINDS.has(source.kind)) {
        problems.push(`${owner.slug}: unknown channel kind "${source.kind}"`);
        continue;
      }
      if (!source.url && !source.handle) {
        problems.push(`${owner.slug}: ${source.kind} source has neither url nor handle`);
        continue;
      }
      sources.push({
        id: `${owner.slug}:${source.kind}:${source.url || source.handle}`,
        entitySlug: owner.slug,
        entityName: owner.name,
        group: owner.group,
        category: owner.category || 'aggregator',
        country: owner.country || null,
        tier: owner.tier ?? 2,
        kind: source.kind,
        url: source.url || null,
        handle: source.handle || null,
        urlFilter: source.url_filter || null,
        pollTier: source.poll_tier || 'warm',
        status: source.status,
        note: source.note || null
      });
    }
  }

  if (problems.length) {
    throw new Error(`watchlist.json is invalid:\n  - ${problems.join('\n  - ')}`);
  }

  return { raw: parsed, sources };
}

/**
 * Selects which sources a run should poll.
 * @param {'hot'|'warm'|'cold'} maxTier include this tier and everything faster
 */
export function selectSources(sources, { maxTier = 'cold', kinds = COLLECTABLE_KINDS, only = null } = {}) {
  const cutoff = TIER_ORDER.indexOf(maxTier);
  return sources.filter((source) => {
    if (!POLLABLE_STATUSES.has(source.status)) return false;
    if (!kinds.has(source.kind)) return false;
    if (TIER_ORDER.indexOf(source.pollTier) > cutoff) return false;
    if (only && source.entitySlug !== only) return false;
    return true;
  });
}

// Why each non-pollable source was skipped — surfaced in the report so silent
// gaps stay visible instead of quietly shrinking coverage over time.
export function explainSkipped(sources) {
  return sources
    .filter((s) => !POLLABLE_STATUSES.has(s.status) || !COLLECTABLE_KINDS.has(s.kind))
    .map((s) => ({
      entity: s.entityName,
      kind: s.kind,
      status: s.status,
      reason: !POLLABLE_STATUSES.has(s.status)
        ? s.status
        : `${s.kind} not automated in v1`,
      note: s.note
    }));
}
