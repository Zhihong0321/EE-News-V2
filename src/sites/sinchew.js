import { sinchewConfig as config } from './sinchew.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';

function malaysiaDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function dateFromArticleUrl(url) {
  const match = new URL(url).pathname.match(/\/news\/(\d{4})(\d{2})(\d{2})\//);
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
    const error = new Error(`Sin Chew returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

export const sinchewAdapter = {
  ...config,
  today: malaysiaDate,

  async collectLinks(page, since) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 30000 });

    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.textContent || ''
    })));

    const seen = new Set();
    return links.filter(({ href }) => {
      const parsed = new URL(href);
      const isSinChew = parsed.hostname === 'sinchew.com.my' || parsed.hostname.endsWith('.sinchew.com.my');
      const isArticle = /^\/news\/\d{8}\/[^/]+\/\d+$/.test(parsed.pathname);
      const articleDate = dateFromArticleUrl(href);
      if (!isSinChew || !isArticle || !articleDate || articleDate < since || seen.has(href)) return false;
      seen.add(href);
      return true;
    }).slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleBody).waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        const jsonLd = [...document.querySelectorAll(selectors.jsonLd)]
          .map((script) => script.textContent)
          .map((value) => {
            try {
              const parsed = JSON.parse(value);
              const entries = Array.isArray(parsed) ? parsed : [parsed];
              return entries.find((entry) => entry?.headline || entry?.datePublished) || {};
            } catch {
              return {};
            }
          })
          .find((entry) => entry.headline || entry.datePublished) || {};
        const meta = (list) => {
          const selectorsToTry = Array.isArray(list) ? list : [list];
          return selectorsToTry.map((selector) => {
            const element = document.querySelector(selector);
            return element?.content || element?.innerText || '';
          }).find(Boolean) || '';
        };
        const author = typeof jsonLd.author === 'object' ? jsonLd.author.name : jsonLd.author;
        return {
          headline: jsonLd.headline || meta(selectors.title),
          datePublished: jsonLd.datePublished || meta(selectors.publishedAt),
          author: author || meta(selectors.author),
          section: jsonLd.articleSection || meta(selectors.section),
          description: jsonLd.description || meta(selectors.description),
          body: [...document.querySelectorAll(`${selectors.articleBody} p`)]
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
