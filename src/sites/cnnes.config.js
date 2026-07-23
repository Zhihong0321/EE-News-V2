// 储能中国网 uses a simple dated article URL layout and server-rendered pages.
export const cnnesConfig = {
  id: 'cnnes',
  source: '储能中国网',
  country: 'CN',
  latestUrl: 'https://www.cnnes.cc/',
  // The site currently serves its working HTML over HTTP; HTTPS times out.
  crawlUrl: 'http://cnnes.cc/',
  timezone: 'Asia/Shanghai',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a[href$=".html"]',
    articleBody: '.view1c',
    title: '.view1a h1',
    publishedAt: '.view1b_L span:first-child',
    author: 'meta[name="author"]',
    section: 'meta[property="article:section"]',
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['储能中国网版权及免责声明：', 'copyright ©']
};
