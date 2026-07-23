export const nhkConfig = {
  id: 'nhk',
  source: 'NHK News',
  country: 'JP',
  latestUrl: 'https://www3.nhk.or.jp/news/',
  feedUrls: ['https://www3.nhk.or.jp/rss/news/cat0.xml'],
  timezone: 'Asia/Tokyo',
  transport: { listing: 'rss', article: 'playwright', browserFallback: true },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href*="/news/html/"]',
    articleBody: ['#news_textbody', '.content--detail-body', '[itemprop="articleBody"]'],
    jsonLd: 'script[type="application/ld+json"]',
    title: ['meta[property="og:title"]', 'h1'],
    publishedAt: ['meta[property="article:published_time"]', 'meta[name="datePublished"]', 'time[datetime]'],
    author: ['meta[name="author"]'],
    section: ['meta[property="article:section"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['関連ニュース', 'あわせて読みたい']
};
