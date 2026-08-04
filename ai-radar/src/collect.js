// The collector: poll every selected source, normalize, dedupe, score.
//
// Failure policy mirrors the parent project — a 403 marks that source blocked
// and stops touching it, transient errors are retried by http.js, and one dead
// source never sinks the run. Every outcome is recorded so the report can show
// source health instead of silently losing coverage.
import { handlerFor } from './channels/index.js';
import { conditionalGetWithRetry, delay, normalizeUrl } from './http.js';
import { radarConfig } from './config.js';
import { loadState, saveState, sourceState, updateSourceState, mergeSeen } from './state.js';
import { isRelevant, classifySignal, detectSubject } from './relevance.js';
import { clusterItems } from './cluster.js';
import { isHardStop } from '../../src/config/crawl-policy.js';

export async function collect(sources, { since, now = new Date() } = {}) {
  const state = await loadState();
  const results = [];
  const health = [];

  // Requests to one host must not overlap, however wide the global pool is.
  const hostQueues = new Map();

  await runPool(sources, radarConfig.concurrency, async (source) => {
    const host = hostOf(source.url);
    const previous = hostQueues.get(host) || Promise.resolve();
    const task = previous
      .catch(() => {})
      .then(async () => {
        const outcome = await pollSource(source, { since, state });
        health.push(outcome.health);
        if (outcome.items.length) results.push(...outcome.items);
        await delay(radarConfig.perHostDelayMs);
      });
    hostQueues.set(host, task);
    return task;
  });

  await saveState(state);

  const deduped = dedupe(results);
  const scored = deduped.map((item) => ({
    ...item,
    score: scoreItem(item, deduped),
    // Clustering groups by subject, so one release covered by Reddit, HN and
    // the lab itself collapses into a single story.
    subjectSlug: detectSubject(item)?.slug || item.entitySlug
  }));
  // Cluster last: scores decide which member represents a story, and the
  // cluster's own size then feeds back into the final score.
  const clustered = clusterItems(scored);

  return {
    items: clustered,
    health,
    since,
    generatedAt: now.toISOString(),
    stats: {
      collected: results.length,
      afterDedupe: deduped.length,
      afterClustering: clustered.length,
      filteredOffTopic: results.filter((r) => r.offTopic).length
    }
  };
}

async function pollSource(source, { since, state }) {
  const handler = handlerFor(source);
  const base = { source: source.id, entity: source.entityName, kind: source.kind, url: source.url };

  if (!handler) {
    return { items: [], health: { ...base, status: 'skipped', detail: 'no handler' } };
  }

  const prior = sourceState(state, source.id);
  const startedAt = Date.now();

  try {
    let raw;

    if (typeof handler.collect === 'function') {
      // Handler owns its requests (Hacker News runs many queries).
      raw = await handler.collect(source, { since });
    } else {
      const response = await conditionalGetWithRetry(source.url, {
        etag: prior.etag,
        lastModified: prior.lastModified,
        accept: handler.accept
      });

      if (response.notModified) {
        return {
          items: [],
          health: { ...base, status: 'not_modified', ms: Date.now() - startedAt, items: 0 }
        };
      }

      updateSourceState(state, source.id, {
        etag: response.etag,
        lastModified: response.lastModified
      });
      raw = await handler.parse(response.body, source);
    }

    const normalized = raw
      .filter((item) => item && item.url)
      .slice(0, radarConfig.maxItemsPerSource)
      .map((item) => ({
        ...item,
        url: safeNormalize(item.url),
        entitySlug: source.entitySlug,
        entityName: source.entityName,
        entityGroup: source.group,
        category: source.category,
        country: source.country,
        tier: source.tier,
        channel: source.kind,
        sourceUrl: source.url,
        signalType: adjustSignal(classifySignal(item, source), item, source)
      }))
      .filter((item) => item.url);

    // Relevance gate. Aggregators publish far more than AI news; without this
    // the report fills with unrelated stories that happened to trend.
    const offTopicCount = normalized.length;
    const relevant = normalized.filter((item) => isRelevant(item, source));
    const dropped = offTopicCount - relevant.length;

    const isFirstRun = !prior.firstRunAt;
    const seenSet = new Set(prior.seen || []);
    let fresh = relevant.filter((item) => isWithinWindow(item, since) && !seenSet.has(item.url));

    // On a first run, suppress only DATELESS items. Those come from sitemaps
    // with no <lastmod> (Mistral, DeepSeek docs), where nothing distinguishes
    // today's post from one published in 2023 — reporting them would dump the
    // whole back catalogue. Dated items need no such guard: the window filter
    // has already established they are recent, so a first run still produces a
    // real report instead of an empty one.
    if (isFirstRun) fresh = fresh.filter((item) => item.publishedAt);

    // The seen-set records everything scanned, not just what passed the
    // relevance gate — otherwise an off-topic item is re-evaluated every run.
    updateSourceState(state, source.id, {
      firstRunAt: prior.firstRunAt || new Date().toISOString(),
      seen: mergeSeen(prior.seen || [], normalized.map((i) => i.url))
    });

    return {
      items: fresh,
      health: {
        ...base,
        status: isFirstRun ? 'seeded' : 'ok',
        ms: Date.now() - startedAt,
        items: fresh.length,
        scanned: normalized.length,
        offTopic: dropped
      }
    };
  } catch (error) {
    const blocked = isHardStop(error);
    return {
      items: [],
      health: {
        ...base,
        status: blocked ? 'blocked' : 'error',
        detail: error.message,
        ms: Date.now() - startedAt,
        items: 0
      }
    };
  }
}

// An item counts if it is dated inside the window, or undated (sitemaps without
// lastmod) — in which case the seen-set is what decides novelty.
function isWithinWindow(item, since) {
  if (!item.publishedAt) return true;
  return new Date(item.publishedAt) >= new Date(since);
}

function dedupe(items) {
  const byUrl = new Map();
  for (const item of items) {
    const existing = byUrl.get(item.url);
    if (!existing) {
      byUrl.set(item.url, { ...item, alsoSeenIn: [] });
      continue;
    }
    // Same story from a second channel: keep the richer record, remember both.
    const keep = richness(item) > richness(existing) ? { ...item, alsoSeenIn: existing.alsoSeenIn } : existing;
    keep.alsoSeenIn = [...new Set([...keep.alsoSeenIn, existing.channel, item.channel])]
      .filter((c) => c !== keep.channel);
    byUrl.set(item.url, keep);
  }
  return [...byUrl.values()];
}

function richness(item) {
  return (item.summary?.length || 0) + (item.publishedAt ? 100 : 0) + (item.hasFullBody ? 500 : 0);
}

// v1 scoring is deliberately a transparent heuristic, not a model: tier and
// signal type dominate, corroboration and traction adjust.
function scoreItem(item, allItems) {
  let score = 0;

  // Weight by the story's SUBJECT where we can identify one, falling back to
  // the publisher's tier. A DeepSeek release reported on Reddit is a tier-1
  // story arriving through a tier-2 channel, not a tier-2 story.
  const subject = detectSubject(item);
  const effectiveTier = subject ? Math.min(subject.tier, item.tier) : item.tier;
  score += effectiveTier === 1 ? 40 : effectiveTier === 2 ? 20 : 10;

  if (item.signalType === 'model_release') score += 30;
  else if (item.signalType === 'research') score += 15;
  else if (item.signalType === 'funding') score += 15;
  // Vendor documentation is on-topic but it is not news, and it is published
  // constantly. Left unpenalized it dominated the top of the report.
  else if (item.signalType === 'guide') score -= 25;

  // First-party beats commentary.
  if (item.entityGroup === 'entity') score += 15;

  // Corroboration: the same entity showing up across several channels today.
  const siblings = allItems.filter((i) => i.entitySlug === item.entitySlug).length;
  score += Math.min(siblings * 3, 15);

  score += Math.min(item.alsoSeenIn?.length * 5 || 0, 10);

  const points = item.metrics?.points ?? 0;
  score += Math.min(Math.floor(points / 50), 10);

  // Recency, gently.
  if (item.publishedAt) {
    const ageHours = (Date.now() - new Date(item.publishedAt)) / 3_600_000;
    if (ageHours < 6) score += 10;
    else if (ageHours < 12) score += 5;
  }

  return Math.min(score, 100);
}

// A cloud vendor announcing someone else's model on their platform is platform
// news, not a model release — "Introducing explicit prompt caching for OpenAI
// GPT-5.6 on Amazon Bedrock" is an AWS product post, and scoring it as a launch
// put it above the actual MiniMax and DeepSeek releases that day.
function adjustSignal(signalType, item, source) {
  if (signalType !== 'model_release') return signalType;
  if (source.category !== 'infra') return signalType;
  const subject = detectSubject(item);
  if (subject && subject.slug !== source.entitySlug) return 'product';
  return signalType;
}

function safeNormalize(url) {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

// Bounded worker pool: at most `limit` tasks in flight at once.
async function runPool(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch {
        // pollSource already converts failures into health rows.
      }
    }
  });
  await Promise.all(workers);
}
