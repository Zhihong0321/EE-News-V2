export const chinapressConfig = {
  id: 'chinapress',
  source: 'China Press',
  latestUrl: 'https://www.chinapress.com.my/',
  timezone: 'Asia/Kuala_Lumpur',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href]',
    articleBody: '.article-page-post-content',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['.article-page-main-title', 'meta[property="og:title"]'],
    publishedAt: ['meta[property="article:published_time"]', '.post_date_meta[data-pdatetime]'],
    author: ['meta[name="author"]'],
    section: ['meta[property="article:section"]', '.article-page-breadcrumb'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['advertisement', 'also read:']
};
