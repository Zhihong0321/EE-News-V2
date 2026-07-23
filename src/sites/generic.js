import { crawlPolicy } from '../config/crawl-policy.js';
import { extractArticle } from '../core/readability.js';

function timezoneDateFormatter(timezone) {
  return (value = new Date()) => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function assertUsableResponse(source, response, url) {
  const status = response?.status();
  if (crawlPolicy.stopStatuses.includes(status)) {
    const error = new Error(`${source} returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

// Config-driven adapter for sites added through the web UI. No site-specific
// date verification is done here (unlike the hand-tuned adapters) - it takes
// the newest links from the listing page in document order and extracts each
// article body generically with Readability.
export function buildGenericAdapter(config) {
  return {
    ...config,
    custom: true,
    today: timezoneDateFormatter(config.timezone),

    async collectLinks(page) {
      const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(config.source, response, config.latestUrl);
      await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: crawlPolicy.navigationTimeoutMs });

      const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
        href: anchor.href,
        title: anchor.textContent ? anchor.textContent.replace(/\s+/g, ' ').trim() : ''
      })));

      const listingUrl = new URL(config.latestUrl);
      const origin = listingUrl.origin;
      const rootDomain = listingUrl.hostname.replace(/^www\./, '');
      const isSameSite = config.allowSubdomains
        ? (href) => {
          try {
            const hostname = new URL(href).hostname;
            return hostname === rootDomain || hostname.endsWith(`.${rootDomain}`);
          } catch {
            return false;
          }
        }
        : (href) => href.startsWith(origin);

      const seen = new Set();
      return links.filter(({ href }) => {
        if (!href || !isSameSite(href) || seen.has(href)) return false;
        seen.add(href);
        return true;
      }).slice(0, config.candidateLimit);
    },

    async readArticle(context, link) {
      const page = await context.newPage();
      try {
        const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
        assertUsableResponse(config.source, response, link.href);
        const html = await page.content();
        const metadata = extractArticle(html, link.href);
        const publishedAt = metadata.datePublished ? new Date(metadata.datePublished) : new Date();

        return {
          source: config.source,
          country: config.country,
          title: (metadata.title || link.title || '').trim(),
          url: link.href,
          published_at: Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString(),
          author: metadata.author || '',
          section: metadata.section || '',
          body: metadata.body || '',
          description: metadata.description || '',
          fetched_at: new Date().toISOString()
        };
      } finally {
        await page.close();
      }
    }
  };
}
