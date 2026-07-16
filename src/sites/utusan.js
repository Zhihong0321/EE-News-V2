import { utusanConfig as config } from './utusan.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';
import { discoverFeedLinks } from '../core/feed.js';
import { fetchHtml } from '../core/http.js';
import { extractArticle } from '../core/readability.js';

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
    ? value.split('\n\n')
      .map(clean)
      .filter((paragraph) => paragraph && !config.ignoredParagraphPrefixes.some((prefix) => paragraph.toLowerCase().startsWith(prefix)))
      .join('\n\n')
    : '';
}

function assertUsableResponse(response, url) {
  const status = response?.status();
  if (crawlPolicy.stopStatuses.includes(status)) {
    const error = new Error(`Utusan returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

export const utusanAdapter = {
  ...config,
  today: malaysiaDate,

  async collectLinksHttp(today) {
    const links = await discoverFeedLinks(config.feedUrls, {
      today,
      timezone: config.timezone,
      limit: config.candidateLimit
    });
    return links.filter((link) => new URL(link.href).hostname === 'www.utusan.com.my');
  },

  async readArticleHttp(link, today) {
    if (new URL(link.href).hostname !== 'www.utusan.com.my') return null;
    const html = await fetchHtml(link.href);
    const metadata = extractArticle(html, link.href);
    const publishedAt = metadata.datePublished ? new Date(metadata.datePublished) : null;
    if (!publishedAt || Number.isNaN(publishedAt.getTime()) || malaysiaDate(publishedAt) !== today) return null;
    return {
      source: config.source,
      title: clean(metadata.title || link.title),
      url: link.href,
      published_at: publishedAt.toISOString(),
      author: clean(metadata.author),
      section: clean(metadata.section),
      body: cleanBody(metadata.body),
      description: clean(metadata.description),
      fetched_at: new Date().toISOString()
    };
  },

  async collectLinks(page, today) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.innerText || anchor.getAttribute('title') || ''
    })));
    const seen = new Set();
    return links.filter(({ href }) => {
      const parsed = new URL(href);
      const isDatedArticle = /\/\d{4}\/\d{2}\/[^/]+\/?$/.test(parsed.pathname);
      if (parsed.hostname !== 'www.utusan.com.my' || !isDatedArticle || seen.has(href)) return false;
      seen.add(href);
      return true;
    }).slice(0, config.candidateLimit);
  },

  async readArticle(context, link, today) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleBody).waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        const entries = [...document.querySelectorAll(selectors.jsonLd)]
          .flatMap((script) => {
            try {
              const parsed = JSON.parse(script.textContent);
              return parsed['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
            } catch {
              return [];
            }
          });
        const article = entries.find((entry) => {
          const type = entry?.['@type'];
          return type === 'Article' || (Array.isArray(type) && type.includes('Article')) || entry?.headline;
        }) || {};
        const meta = (list) => {
          const selectorsToTry = Array.isArray(list) ? list : [list];
          return selectorsToTry.map((selector) => {
            const element = document.querySelector(selector);
            return element?.content || element?.innerText || '';
          }).find(Boolean) || '';
        };
        const author = typeof article.author === 'object' ? article.author.name : article.author;
        const section = Array.isArray(article.articleSection) ? article.articleSection.join(', ') : article.articleSection;
        return {
          headline: article.headline || meta(selectors.title),
          datePublished: article.datePublished || meta(selectors.publishedAt),
          author: author || meta(selectors.author),
          section,
          description: article.description || meta(selectors.description),
          body: [...document.querySelectorAll(`${selectors.articleBody} p`)]
            .map((paragraph) => paragraph.innerText.trim())
            .filter((text) => text && !ignoredParagraphPrefixes.some((prefix) => text.toLowerCase().startsWith(prefix)))
            .join('\n\n')
        };
      }, { selectors: config.selectors, ignoredParagraphPrefixes: config.ignoredParagraphPrefixes });

      const publishedAt = metadata.datePublished ? new Date(metadata.datePublished) : null;
      if (!publishedAt || Number.isNaN(publishedAt.getTime()) || malaysiaDate(publishedAt) !== today) return null;

      return {
        source: config.source,
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
