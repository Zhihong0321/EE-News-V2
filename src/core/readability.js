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
    const decode = (value) => {
      if (!value) return '';
      const node = dom.window.document.createElement('textarea');
      node.innerHTML = value;
      return node.value;
    };
    const metadata = jsonLdMetadata(dom.window.document);
    const parsed = new Readability(dom.window.document).parse() || {};
    const authorValue = Array.isArray(metadata.author) ? metadata.author[0] : metadata.author;
    const author = typeof authorValue === 'object' ? authorValue.name : authorValue;
    const section = Array.isArray(metadata.articleSection) ? metadata.articleSection.join(', ') : metadata.articleSection;
    const contentDom = new JSDOM(parsed.content || '', { url });
    const paragraphs = [...contentDom.window.document.querySelectorAll('p,h2,h3,li')]
      .map((element) => element.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n\n');
    contentDom.window.close();
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
