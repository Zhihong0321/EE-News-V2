// 中国能源网 is a server-rendered portal whose homepage aggregates article links.
export const cnenergynewsConfig = {
  id: 'cnenergynews',
  source: '中国能源网',
  country: 'CN',
  latestUrl: 'https://www.cnenergynews.cn/',
  timezone: 'Asia/Shanghai',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 24,
  selectors: {
    listingArticleLinks: 'a[href^="/article/"]',
    articleBody: ['article', '.article-content', '[class*="article_content"]'],
    title: ['h1', 'meta[property="og:title"]'],
    publishedAt: ['meta[property="article:published_time"]', 'time[datetime]'],
    author: ['meta[name="author"]', '.editor', '.author'],
    section: ['meta[property="article:section"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['分享让更多人看到', '分享到：', '中国能源网版权', '责任编辑：', '相关新闻', '推荐阅读']
};
