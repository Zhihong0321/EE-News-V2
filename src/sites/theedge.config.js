export const theedgeConfig = {
  id: 'theedge',
  source: 'The Edge Malaysia',
  country: 'MY',
  latestUrl: 'https://theedgemalaysia.com/',
  timezone: 'Asia/Kuala_Lumpur',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href*="/node/"]',
    articleRoot: '[class*="news-detail_articleContainerWrapper"]',
    jsonLd: 'script[type="application/ld+json"]',
    title: 'meta[property="og:title"]',
    publishedAt: 'meta[property="article:published_time"]',
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['read also:']
};
