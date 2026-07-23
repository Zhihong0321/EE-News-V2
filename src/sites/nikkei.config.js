export const nikkeiConfig = {
  id: 'nikkei',
  source: 'Nikkei',
  country: 'JP',
  latestUrl: 'https://www.nikkei.com/',
  timezone: 'Asia/Tokyo',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href*="/article/"]',
    articleRoot: 'main article',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['meta[property="og:title"]', 'h1'],
    publishedAt: ['meta[property="article:published_time"]', 'meta[name="datePublished"]', 'time[datetime]'],
    author: ['meta[name="author"]'],
    section: ['meta[property="article:section"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphMarkers: [
    'この記事は会員限定記事です',
    'この記事は会員限定です',
    'この記事の続きは',
    '登録すると続きをお読みいただけます',
    '残り',
    'すべての記事が読み放題',
    '有料会員に登録する',
    '無料会員に登録する',
    'ログインする'
  ]
};
