import Parser from 'rss-parser';
import { fetchText } from './http.js';

const parser = new Parser();

function localDate(value, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(value);
}

function normalizeUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.href;
}

export async function discoverFeedLinks(feedUrls, { today, timezone, limit }) {
  const candidates = [];
  for (const feedUrl of feedUrls) {
    try {
      const xml = await fetchText(feedUrl, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' });
      const feed = await parser.parseString(xml);
      for (const item of feed.items || []) {
        const link = item.link || item.guid;
        const publishedAt = item.isoDate || item.pubDate || item.published;
        if (!link || !publishedAt) continue;
        let normalized;
        try {
          normalized = normalizeUrl(link);
        } catch {
          continue;
        }
        const date = new Date(publishedAt);
        if (Number.isNaN(date.getTime()) || localDate(date, timezone) !== today) continue;
        candidates.push({ href: normalized, title: item.title || '', published_at: date.toISOString() });
      }
    } catch (error) {
      if (feedUrls.length === 1) throw error;
    }
  }
  const seen = new Set();
  return candidates
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .filter((candidate) => !seen.has(candidate.href) && seen.add(candidate.href))
    .slice(0, limit);
}
