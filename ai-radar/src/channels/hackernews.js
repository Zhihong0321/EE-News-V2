// Hacker News via the Algolia API — free, no key, near-realtime.
//
// This channel owns its fetching (it exports `collect`, not `parse`) because a
// single request cannot cover it: `tags=story` returns the newest stories
// regardless of topic, which on a quiet hour contains no AI at all. Instead we
// run one narrow query per watched term and merge.
//
// It doubles as X/Twitter discovery: HN comments and stories routinely link
// x.com/<user>/status/<id>, and those IDs can later be hydrated through the
// public syndication endpoint (PLAN.md §5).
import { conditionalGetWithRetry, normalizeUrl, delay } from '../http.js';
import { radarConfig } from '../config.js';

const ENDPOINT = 'https://hn.algolia.com/api/v1/search_by_date';

// Deliberately narrow. Broad terms like "AI" drag in unrelated startup noise;
// the scoring pass cannot rescue a feed that is 90% irrelevant.
const QUERIES = [
  'OpenAI', 'Anthropic', 'Claude', 'GPT', 'Gemini', 'DeepMind',
  'DeepSeek', 'Qwen', 'Kimi', 'Moonshot AI', 'GLM Zhipu', 'MiniMax',
  'Llama', 'Mistral', 'LLM', 'open weights', 'frontier model'
];

const MIN_POINTS = 10; // Below this, a story has no traction worth reporting.

export async function collect(source, { since }) {
  const sinceUnix = Math.floor(new Date(since).getTime() / 1000);
  const merged = new Map();

  for (const query of QUERIES) {
    const url = `${ENDPOINT}?tags=story&query=${encodeURIComponent(query)}`
      + `&numericFilters=created_at_i>${sinceUnix}&hitsPerPage=20`;

    let response;
    try {
      response = await conditionalGetWithRetry(url, { accept: 'application/json' });
    } catch {
      continue; // One failed query must not sink the channel.
    }
    if (!response.body) continue;

    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      continue;
    }

    for (const hit of payload.hits || []) {
      const points = hit.points ?? 0;
      if (points < MIN_POINTS) continue;

      const target = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      let url;
      try {
        url = normalizeUrl(target);
      } catch {
        continue;
      }
      if (merged.has(url)) continue;

      merged.set(url, {
        url,
        title: (hit.title || '').trim(),
        publishedAt: hit.created_at ? new Date(hit.created_at).toISOString() : null,
        summary: `${points} points · ${hit.num_comments ?? 0} comments on Hacker News`,
        discussionUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
        metrics: { points, comments: hit.num_comments ?? 0 },
        matchedQuery: query
      });
    }

    await delay(radarConfig.perHostDelayMs);
  }

  return [...merged.values()].slice(0, radarConfig.maxItemsPerSource);
}
