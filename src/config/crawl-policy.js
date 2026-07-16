// Shared, compliance-oriented crawl behavior for every site.
export const crawlPolicy = {
  userAgent: 'LocalNewsFetcher/1.0 (local research)',
  retryCount: 2,
  retryDelayMs: 750,
  pageDelayMs: 5000,
  navigationTimeoutMs: 60000,
  blockResourceTypes: ['image', 'font', 'media'],
  stopStatuses: [403, 429]
};
