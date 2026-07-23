import { canonicalizeUrl, publisherFromUrl } from './utils.js';

export function createSearchWeb({ providers, defaultProvider } = {}) {
  if (!providers || Object.keys(providers).length === 0) throw new Error('At least one search provider is required');
  const selectedDefault = defaultProvider || Object.keys(providers)[0];

  return async function searchWeb(query, { provider = selectedDefault, limit = 10 } = {}) {
    const normalizedQuery = String(query || '').replace(/\s+/g, ' ').trim();
    if (!normalizedQuery) throw new Error('search_web requires a non-empty query');
    const activeProvider = providers[provider];
    if (!activeProvider) throw new Error(`Unknown search provider "${provider}"`);
    const startedAt = new Date().toISOString();
    const rawResults = await activeProvider.search(normalizedQuery, { limit });
    const seen = new Set();
    const results = [];

    for (const [index, result] of rawResults.entries()) {
      if (!result.url) continue;
      let url;
      try {
        url = canonicalizeUrl(result.url);
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({
        title: String(result.title || '').trim(),
        url,
        publisher: String(result.publisher || publisherFromUrl(url)).trim(),
        publishedAt: String(result.publishedAt || '').trim() || null,
        snippet: String(result.snippet || '').replace(/\s+/g, ' ').trim(),
        query: normalizedQuery,
        rank: index + 1,
        provider,
        discoveryOnly: true
      });
      if (results.length >= limit) break;
    }

    return { query: normalizedQuery, provider, searchedAt: startedAt, results };
  };
}
