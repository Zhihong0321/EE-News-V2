export const utusanConfig = {
  id: 'utusan',
  source: 'Utusan Malaysia',
  latestUrl: 'https://www.utusan.com.my/terkini/',
  feedUrls: ['https://www.utusan.com.my/feed/'],
  timezone: 'Asia/Kuala_Lumpur',
  transport: { listing: 'rss', article: 'http', browserFallback: true },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'article a[href]',
    articleBody: '.elementor-widget-theme-post-content',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['meta[property="og:title"]', 'h1'],
    publishedAt: ['meta[property="article:published_time"]', 'meta[name="datePublished"]'],
    author: ['meta[name="author"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['advertisement', 'share on', 'baca juga:']
};
