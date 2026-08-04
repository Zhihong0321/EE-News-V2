// Conditional-GET HTTP for AI-RADAR.
//
// The parent project's src/core/http.js is the right tool for one-shot article
// fetches, but the radar polls the same ~40 URLs continuously and must send
// If-None-Match / If-Modified-Since. A 304 costs a few hundred bytes instead of
// re-downloading a 66 KB sitemap every two minutes, which is what makes hot-tier
// polling affordable at all.
//
// Stop-status and retry semantics are imported, not reinvented: 403 is a hard
// stop, 429/5xx are retryable, everything else fails fast.
import { crawlPolicy, isHardStop, isRetryable } from '../../src/config/crawl-policy.js';
import { radarConfig, timeoutForUrl } from './config.js';

const NOT_MODIFIED = 304;

/**
 * @returns {Promise<{status:number, notModified:boolean, body:string|null,
 *                    etag:string|null, lastModified:string|null}>}
 */
export async function conditionalGet(url, { etag, lastModified, accept = '*/*' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutForUrl(url));
  try {
    const headers = { accept, 'user-agent': radarConfig.userAgent };
    if (etag) headers['if-none-match'] = etag;
    if (lastModified) headers['if-modified-since'] = lastModified;

    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });

    if (response.status === NOT_MODIFIED) {
      return { status: NOT_MODIFIED, notModified: true, body: null, etag, lastModified };
    }

    if (crawlPolicy.stopStatuses.includes(response.status)) {
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > radarConfig.maxResponseBytes) {
      throw new Error(`Response exceeded ${radarConfig.maxResponseBytes} bytes for ${url}`);
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > radarConfig.maxResponseBytes) {
        throw new Error(`Response exceeded ${radarConfig.maxResponseBytes} bytes for ${url}`);
      }
      chunks.push(chunk);
    }

    return {
      status: response.status,
      notModified: false,
      body: Buffer.concat(chunks).toString('utf8'),
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    };
  } finally {
    clearTimeout(timer);
  }
}

// Retries transient failures only. A 403 aborts immediately and is re-thrown so
// the caller can mark the source blocked rather than hammering it.
export async function conditionalGetWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= crawlPolicy.retryCount; attempt += 1) {
    try {
      return await conditionalGet(url, options);
    } catch (error) {
      lastError = error;
      if (isHardStop(error) || !isRetryable(error)) throw error;
      if (attempt < crawlPolicy.retryCount) {
        await delay(crawlPolicy.retryDelayMs * (attempt + 1));
      }
    }
  }
  throw lastError;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Strips tracking parameters so the same article from two channels dedupes to
// one URL. Mirrors the normalization in src/core/feed.js.
export function normalizeUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  // Trailing-slash variants are the same page in practice.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.href;
}
