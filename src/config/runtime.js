// Machine-capacity settings, separate from per-site politeness settings.
// Each concurrent site can run articleConcurrency (crawl-policy.js) Playwright
// pages at once, so this is the main lever for total memory/CPU use — tune via
// MAX_CONCURRENT_SITES to match whatever hardware it's running on.
export const runtimeConfig = {
  maxConcurrentSites: Number(process.env.MAX_CONCURRENT_SITES) || 6,
  httpTimeoutMs: 60000,
  maxResponseBytes: 8_000_000
};
