import { cnnesConfig as config } from './cnnes.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';

function chinaDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function dateFromArticleUrl(url) {
  const match = new URL(url).pathname.match(/\/(\d{8})\/\d+\.html$/);
  return match ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}` : null;
}

function parsePublishedAt(value) {
  const match = String(value || '').match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/);
  if (!match) return null;
  const publishedAt = new Date(`${match[1]}T${match[2] || '00:00:00'}+08:00`);
  return Number.isNaN(publishedAt.getTime()) ? null : publishedAt;
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
    const error = new Error(`储能中国网 returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

function isSameSite(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return hostname === 'cnnes.cc' || hostname.endsWith('.cnnes.cc');
}

export const cnnesAdapter = {
  ...config,
  today: chinaDate,

  async collectLinks(page, since) {
    const response = await page.goto(config.crawlUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.crawlUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 30000 });

    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.textContent || ''
    })));

    const seen = new Set();
    return links.filter(({ href }) => {
      const parsedUrl = new URL(href, config.crawlUrl);
      const articleDate = dateFromArticleUrl(parsedUrl.href);
      if (!isSameSite(parsedUrl.href) || !articleDate || articleDate < since || seen.has(parsedUrl.href)) return false;
      seen.add(parsedUrl.href);
      return true;
    }).map(({ href, title }) => ({ href: new URL(href, config.crawlUrl).href, title: clean(title) }))
      .slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleBody).waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        const meta = (selectorList) => {
          const selectorsToTry = Array.isArray(selectorList) ? selectorList : [selectorList];
          return selectorsToTry.map((selector) => document.querySelector(selector)?.content || '').find(Boolean) || '';
        };
        const paragraphs = [...document.querySelectorAll(`${selectors.articleBody} p`)]
          .map((paragraph) => paragraph.innerText.trim())
          .filter((text) => text && !ignoredParagraphPrefixes.some((prefix) => text.toLowerCase().startsWith(prefix.toLowerCase())));

        return {
          headline: document.querySelector(selectors.title)?.innerText || meta('meta[property="og:title"]'),
          datePublished: document.querySelector(selectors.publishedAt)?.innerText || '',
          author: meta(selectors.author),
          section: meta(selectors.section),
          description: meta(selectors.description),
          body: paragraphs.join('\n\n')
        };
      }, { selectors: config.selectors, ignoredParagraphPrefixes: config.ignoredParagraphPrefixes });

      const publishedAt = parsePublishedAt(metadata.datePublished);
      if (!publishedAt || chinaDate(publishedAt) < since) return null;

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
