// Shared, compliance-oriented crawl behavior for every site.
export const crawlPolicy = {
  userAgent: 'LocalNewsFetcher/1.0 (local research)',
  retryCount: 2,
  retryDelayMs: 750,
  pageDelayMs: 5000,
  // How many articles to extract in parallel WITHIN a single site. Each worker
  // still waits pageDelayMs between its own requests, so effective request rate
  // to one origin is ~articleConcurrency per pageDelayMs — keep this modest.
  articleConcurrency: 3,
  navigationTimeoutMs: 60000,
  blockResourceTypes: ['image', 'font', 'media'],
  // Statuses that make adapters/http.js throw an error carrying `.status` (so the
  // retry classifier below can see it). 403 = actively blocked, 429 = rate
  // limited. NOTE: this list only tags errors; whether an attempt is retried or
  // aborts the run is decided by isHardStop/isRetryable, not by membership here.
  stopStatuses: [403, 429],
  // A 403 aborts the WHOLE crawl immediately — we're being blocked and hammering
  // makes it worse. Nothing else is crawl-fatal.
  hardStopStatuses: [403],
  // Transient HTTP statuses worth retrying: 429 (rate limited) and 5xx (server
  // hiccups). Every other 4xx is a client error we fail fast on.
  retryStatuses: [408, 425, 429, 500, 502, 503, 504]
};

// A crawl-fatal error: abort the entire run. Only a 403 (actively blocked).
export function isHardStop(error) {
  return Boolean(error) && crawlPolicy.hardStopStatuses.includes(error.status);
}

// Should a failed attempt be retried? Retry transient failures only: the
// configured retry statuses (429/5xx) and timeouts / network / abort errors
// (which carry no HTTP status). Fail fast on 4xx client errors (400/401/422/…)
// and on hard-stop statuses.
export function isRetryable(error) {
  if (!error || isHardStop(error)) return false;
  const status = error.status;
  if (typeof status === 'number') return crawlPolicy.retryStatuses.includes(status);
  // No HTTP status => timeout / abort / network error => transient, retry it.
  return true;
}
