import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

function firstMeta(document, selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element?.content) return element.content;
  }
  return '';
}

function jsonLdMetadata(document) {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent);
      const entries = parsed?.['@graph'] || (Array.isArray(parsed) ? parsed : [parsed]);
      const article = entries.find((entry) => entry?.headline || entry?.datePublished);
      if (article) return article;
    } catch {
      // Ignore malformed JSON-LD and continue with meta tags/readability.
    }
  }
  return {};
}

export function extractArticle(html, url) {
  const dom = new JSDOM(html, { url });
  try {
    // Reuse a single detached <textarea> for HTML-entity decoding instead of
    // creating a fresh DOM node on every call (decode runs ~6x per article).
    const decodeNode = dom.window.document.createElement('textarea');
    const decode = (value) => {
      if (!value) return '';
      decodeNode.innerHTML = value;
      return decodeNode.value;
    };
    const metadata = jsonLdMetadata(dom.window.document);
    // Reuse the DOM Readability already parsed: it exposes the cleaned article
    // element on parse().content, but we can read the textual structure directly
    // from a fragment inside the same window rather than spinning up a 2nd JSDOM.
    const parsed = new Readability(dom.window.document).parse() || {};
    const authorValue = Array.isArray(metadata.author) ? metadata.author[0] : metadata.author;
    const author = typeof authorValue === 'object' ? authorValue.name : authorValue;
    const section = Array.isArray(metadata.articleSection) ? metadata.articleSection.join(', ') : metadata.articleSection;
    const contentFragment = dom.window.document.createElement('div');
    contentFragment.innerHTML = parsed.content || '';
    const paragraphs = [...contentFragment.querySelectorAll('p,h2,h3,li')]
      .map((element) => element.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n');
    return {
      title: decode(metadata.headline || parsed.title || firstMeta(dom.window.document, ['meta[property="og:title"]', 'meta[name="title"]'])),
      datePublished: decode(metadata.datePublished || firstMeta(dom.window.document, ['meta[property="article:published_time"]', 'meta[name="datePublished"]'])),
      author: decode(author || firstMeta(dom.window.document, ['meta[name="author"]'])),
      section: decode(section || firstMeta(dom.window.document, ['meta[property="article:section"]'])),
      description: decode(metadata.description || firstMeta(dom.window.document, ['meta[name="description"]', 'meta[property="og:description"]'])),
      body: paragraphs || parsed.textContent || ''
    };
  } finally {
    dom.window.close();
  }
}
