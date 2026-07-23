import { nikkeiConfig as config } from './nikkei.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';

function japanDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function clean(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function cleanBody(value) {
  return typeof value === 'string'
    ? value.split('\n\n').map(clean).filter(Boolean).join('\n\n')
    : '';
}

function assertUsableResponse(response, url) {
  const status = response?.status();
  if (crawlPolicy.stopStatuses.includes(status)) {
    const error = new Error(`${config.source} returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

export const nikkeiAdapter = {
  ...config,
  today: japanDate,

  async collectLinks(page) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 30000 });

    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.innerText || anchor.textContent || ''
    })));

    const seen = new Set();
    return links.filter(({ href }) => {
      let parsed;
      try {
        parsed = new URL(href);
      } catch {
        return false;
      }
      if (parsed.origin !== 'https://www.nikkei.com' || !parsed.pathname.startsWith('/article/') || seen.has(parsed.href)) return false;
      seen.add(parsed.href);
      return true;
    }).slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleRoot).first().waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphMarkers }) => {
        const jsonLd = [...document.querySelectorAll(selectors.jsonLd)]
          .flatMap((script) => {
            try {
              const parsed = JSON.parse(script.textContent);
              return parsed?.['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
            } catch {
              return [];
            }
          })
          .find((entry) => entry?.headline || entry?.datePublished) || {};

        const meta = (selectorList) => {
          const selectorsToTry = Array.isArray(selectorList) ? selectorList : [selectorList];
          return selectorsToTry.map((selector) => {
            const element = document.querySelector(selector);
            return element?.content || element?.getAttribute('datetime') || element?.innerText || '';
          }).find(Boolean) || '';
        };
        const root = document.querySelector(selectors.articleRoot) || document.querySelector('main');
        const authorValue = Array.isArray(jsonLd.author) ? jsonLd.author[0] : jsonLd.author;
        const author = typeof authorValue === 'object' ? authorValue?.name : authorValue;
        const section = Array.isArray(jsonLd.articleSection) ? jsonLd.articleSection.join(', ') : jsonLd.articleSection;
        const body = root
          ? [...root.querySelectorAll('p, h2, h3, li')]
            .map((element) => element.innerText.trim())
            .filter((text) => text && !ignoredParagraphMarkers.some((marker) => text.includes(marker)))
            .join('\n\n')
          : '';

        return {
          headline: jsonLd.headline || meta(selectors.title),
          datePublished: jsonLd.datePublished || meta(selectors.publishedAt),
          author: author || meta(selectors.author),
          section: section || meta(selectors.section),
          description: jsonLd.description || meta(selectors.description),
          body
        };
      }, { selectors: config.selectors, ignoredParagraphMarkers: config.ignoredParagraphMarkers });

      const publishedAt = metadata.datePublished ? new Date(metadata.datePublished) : null;
      if (!publishedAt || Number.isNaN(publishedAt.getTime()) || japanDate(publishedAt) < since) return null;

      return {
        source: config.source,
        country: config.country,
        title: clean(metadata.headline || link.title),
        url: link.href,
        published_at: publishedAt.toISOString(),
        author: clean(metadata.author),
        section: clean(metadata.section),
        body: cleanBody(metadata.body),
        description: clean(metadata.description),
        fetched_at: new Date().toISOString()
      };
    } finally {
      await page.close();
    }
  }
};
