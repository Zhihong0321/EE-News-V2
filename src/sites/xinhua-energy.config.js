// Xinhua Energy pages are server-rendered and use date-coded article URLs.
export const xinhuaEnergyConfig = {
  id: 'xinhua-energy',
  source: '新华能源',
  country: 'CN',
  latestUrl: 'https://www.news.cn/energy/',
  timezone: 'Asia/Shanghai',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href*="/energy/"][href$="/c.html"]',
    articleBody: ['#detailContent', '#detail', 'article'],
    title: ['.head-line h1', '.mheader h1', 'h1'],
    publishedAt: ['.mheader .info', '.header-time', 'meta[property="article:published_time"]', 'meta[name="publishdate"]'],
    author: ['meta[name="author"]', '.editor', '.zrbj'],
    section: ['meta[property="article:section"]', 'meta[name="channel"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['分享到：', '【责任编辑', '责任编辑：', '阅读下一篇：']
};
