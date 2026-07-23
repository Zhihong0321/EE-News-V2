export const sinchewConfig = {
  id: 'sinchew',
  source: 'Sin Chew Daily',
  country: 'MY',
  latestUrl: 'https://www.sinchew.com.my/latest',
  timezone: 'Asia/Kuala_Lumpur',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href*="/news/"]',
    articleBody: '.article-page-content[itemprop="articleBody"]',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['.article-page-title h1', 'meta[property="og:title"]', 'meta[name="title"]'],
    publishedAt: ['meta[property="article:published_time"]', 'meta[name="datePublished"]'],
    author: ['meta[name="author"]', '.article-page-author'],
    section: ['meta[property="article:section"]', '.article-page-breadcrumb h2'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['advertisement', '相关报道']
};
