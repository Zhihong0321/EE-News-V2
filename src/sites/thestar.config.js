// The Star's current page structure and crawl limits.
export const thestarConfig = {
  id: 'thestar',
  source: 'The Star',
  latestUrl: 'https://www.thestar.com.my/news/latest',
  timezone: 'Asia/Kuala_Lumpur',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[data-content-type="Article"]',
    articleBody: '#story-body',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['meta[itemprop="headline"]', 'meta[name="content_title"]'],
    publishedAt: ['meta[itemprop="datePublished"]', 'meta[name="datePublished"]'],
    section: 'meta[property="article:section"]',
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['also read:']
};
