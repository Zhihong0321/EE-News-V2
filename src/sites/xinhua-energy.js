import { xinhuaEnergyConfig as config } from './xinhua-energy.config.js';
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
  const match = new URL(url).pathname.match(/\/energy\/(\d{8})\//);
  return match ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}` : null;
}

function parsePublishedAt(value) {
  const match = String(value || '').match(/(20\d{2})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2})(?:\D{1,4}(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const publishedAt = new Date(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}T${(match[4] || '00').padStart(2, '0')}:${match[5] || '00'}:${match[6] || '00'}+08:00`);
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
    const error = new Error(`新华能源 returned HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
}

function isSameSite(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return hostname === 'news.cn'
    || hostname.endsWith('.news.cn')
    || hostname === 'xinhuanet.com'
    || hostname.endsWith('.xinhuanet.com');
}

export const xinhuaEnergyAdapter = {
  ...config,
  today: chinaDate,

  async collectLinks(page, since) {
    const response = await page.goto(config.latestUrl, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
    assertUsableResponse(response, config.latestUrl);
    await page.locator(config.selectors.listingArticleLinks).first().waitFor({ state: 'attached', timeout: 30000 });

    const links = await page.locator(config.selectors.listingArticleLinks).evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      title: anchor.getAttribute('title') || anchor.textContent || ''
    })));

    const seen = new Set();
    return links.filter(({ href }) => {
      const parsedUrl = new URL(href, config.latestUrl);
      const isArticle = /^\/energy\/\d{8}\/[a-f0-9]{32}\/c\.html$/i.test(parsedUrl.pathname);
      const articleDate = dateFromArticleUrl(parsedUrl.href);
      if (!isArticle || !isSameSite(parsedUrl.href) || !articleDate || articleDate < since || seen.has(parsedUrl.href)) return false;
      seen.add(parsedUrl.href);
      return true;
    }).map(({ href, title }) => ({ href: new URL(href, config.latestUrl).href, title: clean(title) }))
      .slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: crawlPolicy.navigationTimeoutMs });
      assertUsableResponse(response, link.href);
      await page.locator(config.selectors.articleBody.join(', ')).first().waitFor({ state: 'attached', timeout: 30000 });

      const metadata = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        const readElement = (selectorList) => {
          const selectorsToTry = Array.isArray(selectorList) ? selectorList : [selectorList];
          return selectorsToTry.map((selector) => {
            const element = document.querySelector(selector);
            return element?.getAttribute('content') || element?.innerText || '';
          }).find(Boolean) || '';
        };
        const bodyElement = selectors.articleBody.map((selector) => document.querySelector(selector)).find(Boolean);
        const bodyParagraphs = bodyElement
          ? [...bodyElement.querySelectorAll('p')]
            .map((paragraph) => paragraph.innerText.trim())
            .filter((text) => text && !ignoredParagraphPrefixes.some((prefix) => text.toLowerCase().startsWith(prefix.toLowerCase())))
          : [];
        const pageText = document.body.innerText || '';
        const visibleDate = pageText.match(/20\d{2}\s+\d{1,2}\s*\/\s*\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?|20\d{2}[年\-/]\s*\d{1,2}[月\-/]\s*\d{1,2}(?:日\s*\d{1,2}:\d{2}(?::\d{2})?)?/u)?.[0] || '';

        return {
          headline: readElement(selectors.title) || readElement('meta[property="og:title"]'),
          datePublished: readElement(selectors.publishedAt) || visibleDate,
          author: readElement(selectors.author),
          section: readElement(selectors.section),
          description: readElement(selectors.description),
          body: bodyParagraphs.join('\n\n') || bodyElement?.innerText || ''
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
