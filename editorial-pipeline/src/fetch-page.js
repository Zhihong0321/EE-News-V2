import { crawlPolicy } from '../../src/config/crawl-policy.js';
import { fetchAdapterArticle } from '../../src/core/runner.js';
import { findAdapterForUrl } from './adapter-registry.js';
import { cleanText, dateHintFromUrl, extractionQuality, nowIso, publisherFromUrl, sha256 } from './utils.js';

function excerptsFromText(text) {
  return text.split(/\n{2,}/).filter(Boolean).slice(0, 3).map((excerpt) => excerpt.slice(0, 500));
}

function normalizeSuccess({ requestedUrl, fetcherUsed, adapter, fallback, payload, retrievedAt }) {
  const cleanedText = cleanText(payload.body || payload.cleanedText || payload.markdown || '');
  const finalUrl = payload.finalUrl || payload.url || requestedUrl;
  const document = {
    id: sha256(finalUrl),
    requestedUrl,
    finalUrl,
    statusCode: payload.statusCode || 200,
    title: String(payload.title || '').trim(),
    publishedAt: payload.publishedAt || payload.published_at || null,
    author: String(payload.author || '').trim() || null,
    publisher: String(payload.publisher || payload.source || publisherFromUrl(finalUrl)).trim(),
    cleanedText,
    excerpts: excerptsFromText(cleanedText),
    extractionQuality: null,
    failureReason: null,
    rawSourceMetadata: payload.metadata || payload.rawSourceMetadata || {},
    fetcherUsed,
    adapterName: adapter?.id || null,
    adapterTransport: payload.adapterTransport || null,
    fallback: fallback || null,
    retrievedAt,
    contentHash: sha256(cleanedText)
  };
  document.extractionQuality = extractionQuality(document);
  return document;
}

function normalizeFailure({ requestedUrl, fetcherUsed, adapter, fallback, error, retrievedAt }) {
  return {
    id: sha256(requestedUrl),
    requestedUrl,
    finalUrl: requestedUrl,
    statusCode: error.status || null,
    title: '',
    publishedAt: null,
    author: null,
    publisher: publisherFromUrl(requestedUrl),
    cleanedText: '',
    excerpts: [],
    extractionQuality: { score: 0, signals: {} },
    failureReason: error.message,
    failureCode: error.code || null,
    rawSourceMetadata: {},
    fetcherUsed,
    adapterName: adapter?.id || null,
    adapterTransport: null,
    fallback: fallback || null,
    retrievedAt,
    contentHash: sha256('')
  };
}

export function createFetchPage({
  adapterFinder = findAdapterForUrl,
  adapterFetcher = fetchAdapterArticle,
  crawl4aiFetcher,
  clock
} = {}) {
  if (!crawl4aiFetcher) throw new Error('A Crawl4AI fallback fetcher is required');

  return async function fetchPage(url, options = {}) {
    const requestedUrl = new URL(url).href;
    const retrievedAt = nowIso(clock);
    const adapter = await adapterFinder(requestedUrl);
    let adapterFailure = null;

    if (adapter) {
      try {
        const result = await adapterFetcher(adapter, requestedUrl, {
          date: options.date || dateHintFromUrl(requestedUrl) || adapter.today()
        });
        return normalizeSuccess({
          requestedUrl,
          fetcherUsed: 'custom-site-crawler',
          adapter,
          payload: { ...result.article, adapterTransport: result.transport },
          retrievedAt
        });
      } catch (error) {
        if (crawlPolicy.stopStatuses.includes(error.status) || error.code === 'ROBOTS_DISALLOWED') {
          return normalizeFailure({ requestedUrl, fetcherUsed: 'custom-site-crawler', adapter, error, retrievedAt });
        }
        adapterFailure = error;
      }
    }

    const fallback = adapter ? {
      from: 'custom-site-crawler',
      reason: adapterFailure?.message || 'adapter did not return a usable article'
    } : null;
    try {
      const result = await crawl4aiFetcher(requestedUrl, options);
      return normalizeSuccess({
        requestedUrl,
        fetcherUsed: 'crawl4ai',
        adapter,
        fallback,
        payload: result,
        retrievedAt
      });
    } catch (error) {
      return normalizeFailure({ requestedUrl, fetcherUsed: 'crawl4ai', adapter, fallback, error, retrievedAt });
    }
  };
}
