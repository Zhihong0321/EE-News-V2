// AI-RADAR runtime settings. Crawl politeness (retry counts, stop statuses) is
// deliberately NOT duplicated here — it is imported from the parent project's
// src/config/crawl-policy.js so both subsystems obey one rulebook.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const radarConfig = {
  root: path.resolve(here, '..'),
  watchlistPath: path.resolve(here, '..', 'watchlist.json'),

  // Conditional-GET bookkeeping and per-source URL baselines. Without this a
  // no-lastmod sitemap (Mistral) would report all 237 articles as "new" on
  // every run.
  statePath: path.resolve(here, '..', 'state', 'sources.json'),

  outputDir: path.resolve(here, '..', '..', 'output', 'ai-radar'),

  // Honest identification. We are not pretending to be a browser: any operator
  // who wants to block or rate-limit this can do so by name.
  userAgent: 'AI-RADAR/0.1 (+https://github.com/; AI news monitor; contact via repo)',

  httpTimeoutMs: 30_000,
  // China-hosted origins (zhipuai.cn et al) routinely take 20s+ from outside CN.
  slowHostTimeoutMs: 45_000,
  slowHosts: ['zhipuai.cn', 'bigmodel.cn', 'moonshot.cn', 'qbitai.com', 'jiqizhixin.com'],

  maxResponseBytes: 8_000_000,

  // How many sources are fetched at once, globally. Requests to the SAME host
  // are serialized regardless of this (see collect.js).
  concurrency: 6,
  perHostDelayMs: 1_000,

  // Default reporting window.
  windowHours: 24,

  // Cap per source so one noisy feed cannot dominate a report.
  maxItemsPerSource: 40,

  // Remember this many URLs per source for new-vs-seen diffing.
  maxSeenUrlsPerSource: 500
};

export function timeoutForUrl(url) {
  try {
    const { hostname } = new URL(url);
    const slow = radarConfig.slowHosts.some((h) => hostname.endsWith(h));
    return slow ? radarConfig.slowHostTimeoutMs : radarConfig.httpTimeoutMs;
  } catch {
    return radarConfig.httpTimeoutMs;
  }
}
