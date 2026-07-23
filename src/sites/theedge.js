import { theedgeConfig as config } from './theedge.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';

function malaysiaDate(value = new Date()) {
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
    const error = new Error(`The Edge returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

export const theedgeAdapter = {
  ...config,
  today: malaysiaDate,

  async collectLinks(page) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 15000 });
    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.textContent || ''
    })));
    const seen = new Set();
    return links.filter(({ href }) => {
      const parsed = new URL(href);
      if (parsed.hostname !== 'theedgemalaysia.com' || !/^\/node\/\d+$/.test(parsed.pathname) || seen.has(href)) return false;
      seen.add(href);
      return true;
    }).slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleRoot).waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        const root = document.querySelector(selectors.articleRoot);
        const meta = (list) => {
          const selectorsToTry = Array.isArray(list) ? list : [list];
          return selectorsToTry.map((selector) => document.querySelector(selector)?.content || '').find(Boolean) || '';
        };
        const byline = [...root.querySelectorAll('a')].map((anchor) => anchor.innerText.trim()).filter(Boolean);
        const authorIndex = byline.findIndex((value) => value.toLowerCase() === 'theedgemalaysia.com' || value.toLowerCase() === 'the edge malaysia');
        const author = authorIndex > 0 ? byline[authorIndex - 1] : '';
        const title = meta(selectors.title);
        return {
          headline: title || root.querySelector('h1')?.innerText || '',
          datePublished: meta(selectors.publishedAt),
          author,
          section: '',
          description: meta(selectors.description),
          body: [...root.querySelectorAll('p')]
            .map((paragraph) => paragraph.innerText.trim())
            .filter((text) => text && !ignoredParagraphPrefixes.some((prefix) => text.toLowerCase().startsWith(prefix)))
            .join('\n\n')
        };
      }, { selectors: config.selectors, ignoredParagraphPrefixes: config.ignoredParagraphPrefixes });

      const publishedAt = metadata.datePublished ? new Date(metadata.datePublished) : null;
      if (!publishedAt || Number.isNaN(publishedAt.getTime()) || malaysiaDate(publishedAt) < since) return null;

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
