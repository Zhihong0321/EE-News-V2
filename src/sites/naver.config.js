// NOTE (2026-07-21): Naver's robots.txt sets `User-agent: * / Disallow: /` — the
// entire site is blocked for generic crawlers, and it explicitly prohibits scraping
// for AI training/RAG. The project runner enforces robots.txt (src/core/runner.js),
// so live fetches abort with "robots.txt disallows ...". This adapter is complete and
// passes registry tests, but CANNOT produce output without bypassing robots.txt, which
// is out of scope per the ADDING_SITE.md definition of done ("no bypassing locked
// content"). Left registered but non-functional pending a decision. Prefer a
// crawl-permitted Korean source (e.g. Yonhap/yna.co.kr) instead.
export default {
  id: 'naver',
  source: 'Naver News',
  country: 'KR',
  latestUrl: 'https://news.naver.com/section/105', // IT/Science section
  timezone: 'Asia/Seoul',
  transport: { listing: 'playwright', article: 'playwright' },
  articleLimit: 3,
  candidateLimit: 12,
  selectors: {
    listingArticleLinks: 'a.sa_text_title',
    articleBody: '#dic_area',
    jsonLd: 'script[type="application/ld+json"]',
    title: ['h2#title_area span', 'meta[property="og:title"]', 'meta[name="title"]'],
    publishedAt: ['span.media_end_head_info_datestamp_time', 'meta[property="article:published_time"]'],
    author: ['em.media_end_head_journalist_name', 'meta[name="author"]'],
    section: ['em.media_end_categorize_item', 'meta[property="article:section"]'],
    description: ['meta[name="description"]', 'meta[property="og:description"]']
  },
  ignoredParagraphPrefixes: ['reporter@', '기자 =', '※', '▶', '◆']
};
