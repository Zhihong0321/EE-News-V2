import config from './naver.config.js';
import { crawlPolicy } from '../config/crawl-policy.js';

// Returns YYYY-MM-DD in Korea Standard Time (UTC+9)
function koreaDate(value = new Date()) {
  return value.toLocaleDateString('en-CA', { timeZone: config.timezone });
}

function clean(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function cleanBody(value) {
  if (!value) return '';
  return value
    .split('\n\n')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function assertUsableResponse(response) {
  if (response && crawlPolicy.stopStatuses.includes(response.status())) {
    const err = new Error(`HTTP ${response.status()}`);
    err.status = response.status();
    throw err;
  }
}

const naverAdapter = {
  ...config,

  today: koreaDate,

  async collectLinks(page) {
    const response = await page.goto(config.latestUrl, {
      waitUntil: 'domcontentloaded'
    });
    assertUsableResponse(response);

    await page.waitForSelector(config.selectors.listingArticleLinks, {
      state: 'attached',
      timeout: 30_000
    });

    const rawLinks = await page.evaluate((selector) => {
      return Array.from(document.querySelectorAll(selector)).map(el => ({
        href: el.href,
        title: el.textContent?.trim() ?? ''
      }));
    }, config.selectors.listingArticleLinks);

    // Deduplicate by href; accept n.news.naver.com article URLs only
    const seen = new Set();
    const links = rawLinks.filter(({ href }) => {
      try {
        const url = new URL(href);
        const isArticle =
          (url.hostname === 'n.news.naver.com' || url.hostname === 'news.naver.com') &&
          /\/article\//.test(url.pathname);
        if (!isArticle || seen.has(href)) return false;
        seen.add(href);
        return true;
      } catch {
        return false;
      }
    });

    return links.slice(0, config.candidateLimit);
  },

  async readArticle(context, link, since) {
    const page = await context.newPage();
    try {
      const response = await page.goto(link.href, {
        waitUntil: 'domcontentloaded'
      });
      assertUsableResponse(response);

      await page.waitForSelector(config.selectors.articleBody, {
        state: 'attached',
        timeout: 30_000
      });

      const raw = await page.evaluate(({ selectors, ignoredParagraphPrefixes }) => {
        // Helper: first non-empty value from a list of selectors
        function pick(selectorList) {
          for (const sel of selectorList) {
            const el = document.querySelector(sel);
            if (!el) continue;
            const val = el.getAttribute('content') ?? el.textContent;
            if (val?.trim()) return val.trim();
          }
          return '';
        }

        // JSON-LD: prefer datePublished and headline from NewsArticle schema
        let jsonLdDate = '';
        let jsonLdTitle = '';
        for (const el of document.querySelectorAll(selectors.jsonLd)) {
          try {
            const data = JSON.parse(el.textContent);
            const item = Array.isArray(data) ? data[0] : data;
            if (item.datePublished) jsonLdDate = item.datePublished;
            if (item.headline) jsonLdTitle = item.headline;
          } catch { /* ignore */ }
        }

        // Body: all <p> inside #dic_area, filtered by ignored prefixes
        const bodyEl = document.querySelector(selectors.articleBody);
        const body = bodyEl
          ? Array.from(bodyEl.querySelectorAll('p'))
              .map(p => p.innerText?.trim() ?? '')
              .filter(t => t.length > 0)
              .filter(t => !ignoredParagraphPrefixes.some(pre => t.toLowerCase().startsWith(pre.toLowerCase())))
              .join('\n\n')
          : '';

        return {
          title:       jsonLdTitle || pick(selectors.title),
          publishedAt: jsonLdDate  || pick(selectors.publishedAt),
          author:      pick(selectors.author),
          section:     pick(selectors.section),
          description: pick(selectors.description),
          body
        };
      }, { selectors: config.selectors, ignoredParagraphPrefixes: config.ignoredParagraphPrefixes });

      // Date guard: article must be on/after `since` in Korea time
      if (!raw.publishedAt) return null;
      const articleDate = koreaDate(new Date(raw.publishedAt));
      if (articleDate < since) return null;

      return {
        source:       config.source,
        country:      config.country,
        title:        clean(raw.title),
        url:          link.href,
        published_at: new Date(raw.publishedAt).toISOString(),
        author:       clean(raw.author),
        section:      clean(raw.section),
        body:         cleanBody(raw.body),
        description:  clean(raw.description),
        fetched_at:   new Date().toISOString()
      };
    } finally {
      await page.close();
    }
  }
};

export { naverAdapter };
