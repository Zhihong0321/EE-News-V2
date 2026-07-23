import { nhkConfig as config } from './nhk.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';
import { discoverFeedLinks } from '../core/feed.js';

function japanDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function dateFromArticleUrl(url) {
  const match = new URL(url).pathname.match(/\/news\/html\/(\d{4})(\d{2})(\d{2})\//);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
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

export const nhkAdapter = {
  ...config,
  today: japanDate,

  async collectLinksHttp(since) {
    const links = await discoverFeedLinks(config.feedUrls, {
      since,
      timezone: config.timezone,
      limit: config.candidateLimit
    });
    return links.map((link) => ({
      ...link,
      href: new URL(link.href).href.replace(/^http:/, 'https:')
    }));
  },

  async collectLinks(page, since) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 30000 });

    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.innerText || anchor.textContent || ''
    })));

    const seen = new Set();
    return links.filter(({ href }) => {
      if (!href || !href.startsWith('https://www3.nhk.or.jp/news/html/')) return false;
      const articleDate = dateFromArticleUrl(href);
      if (!articleDate || articleDate < since || seen.has(href)) return false;
      seen.add(href);
      return true;
    }).slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleBody.join(', ')).first().waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
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
        const bodyRoot = selectors.articleBody
          .map((selector) => document.querySelector(selector))
          .find(Boolean);
        const author = typeof jsonLd.author === 'object' ? jsonLd.author.name : jsonLd.author;
        const section = Array.isArray(jsonLd.articleSection) ? jsonLd.articleSection.join(', ') : jsonLd.articleSection;
        const body = bodyRoot
          ? [...bodyRoot.querySelectorAll('p, h2, h3, li')]
            .map((element) => element.innerText.trim())
            .filter((text) => text && !ignoredParagraphPrefixes.some((prefix) => text.startsWith(prefix)))
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
      }, { selectors: config.selectors, ignoredParagraphPrefixes: config.ignoredParagraphPrefixes });

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