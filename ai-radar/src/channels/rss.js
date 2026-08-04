// RSS / Atom channel. Also serves `github_releases`, since GitHub's
// releases.atom is plain Atom — a release tag arrives as an entry like any post.
import Parser from 'rss-parser';
import { normalizeUrl } from '../http.js';

const parser = new Parser({
  customFields: { item: [['content:encoded', 'contentEncoded']] }
});

const FEED_ACCEPT = 'application/rss+xml,application/atom+xml,application/xml,text/xml,*/*';

export const accept = FEED_ACCEPT;

export function parse(body, source) {
  return parser.parseString(body).then((feed) => {
    const items = [];
    for (const item of feed.items || []) {
      const link = item.link || item.guid;
      if (!link) continue;

      let url;
      try {
        url = normalizeUrl(link);
      } catch {
        continue;
      }

      const rawDate = item.isoDate || item.pubDate || item.published || item.updated;
      const date = rawDate ? new Date(rawDate) : null;
      const publishedAt = date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;

      // Feeds that ship content:encoded (AI News does) give us the full body
      // with no second request — the cheapest possible channel.
      const body = item.contentEncoded || item.content || item.contentSnippet || item.summary || '';

      items.push({
        url,
        title: (item.title || '').trim(),
        publishedAt,
        summary: stripHtml(body).slice(0, 600),
        hasFullBody: Boolean(item.contentEncoded),
        author: item.creator || item.author || null,
        signalType: source.kind === 'github_releases' ? 'model_release' : null
      });
    }
    return items;
  });
}

function stripHtml(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
