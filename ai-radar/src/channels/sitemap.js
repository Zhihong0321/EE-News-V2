// Sitemap channel — the reason Anthropic, Mistral, ByteDance and DeepSeek need
// no Playwright adapter.
//
// A sitemap is a structured URL list the site publishes *for* crawlers, often
// with <lastmod>. Diffing it detects new articles without CSS selectors and
// without breaking on a redesign. ByteDance's blog renders zero links in raw
// HTML yet its sitemap is clean static XML.
//
// Two shapes are handled: <urlset> (the list) and <sitemapindex> (a list of
// lists — Mistral's, which we follow one level down).
import { conditionalGetWithRetry, normalizeUrl } from '../http.js';

export const accept = 'application/xml,text/xml,*/*';

const MAX_CHILD_SITEMAPS = 5;

export async function parse(body, source) {
  let xml = body;

  if (isSitemapIndex(xml)) {
    const children = extractTags(xml, 'loc').slice(0, MAX_CHILD_SITEMAPS);
    const parts = [];
    for (const child of children) {
      try {
        const response = await conditionalGetWithRetry(child, { accept });
        if (response.body) parts.push(response.body);
      } catch {
        // One unreachable child sitemap should not lose the others.
      }
    }
    xml = parts.join('\n');
  }

  const entries = extractUrlEntries(xml);
  const filter = source.urlFilter;

  const items = [];
  for (const entry of entries) {
    if (filter && !entry.loc.includes(filter)) continue;

    let url;
    try {
      url = normalizeUrl(entry.loc);
    } catch {
      continue;
    }

    items.push({
      url,
      title: titleFromUrl(url),
      publishedAt: entry.lastmod ? isoOrNull(entry.lastmod) : null,
      summary: '',
      // Sitemaps carry no body. Without lastmod (Mistral) there is no date
      // either, so collect.js falls back to first-seen detection.
      needsExtraction: true
    });
  }
  return items;
}

function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml);
}

function extractUrlEntries(xml) {
  const entries = [];
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/gi) || [];
  for (const block of blocks) {
    const loc = extractTags(block, 'loc')[0];
    if (!loc) continue;
    entries.push({ loc, lastmod: extractTags(block, 'lastmod')[0] || null });
  }
  // Some sitemaps put <loc> outside a <url> wrapper; fall back to a flat scan.
  if (!entries.length) {
    for (const loc of extractTags(xml, 'loc')) entries.push({ loc, lastmod: null });
  }
  return entries;
}

function extractTags(xml, tag) {
  const matches = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi')) || [];
  return matches.map((m) => m.replace(new RegExp(`</?${tag}>`, 'gi'), '').trim());
}

function isoOrNull(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// "…/news/claude-opus-5-release" -> "Claude Opus 5 Release".
// A placeholder until the article itself is extracted; still readable in a report.
function titleFromUrl(url) {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return slug
      .replace(/[-_]+/g, ' ')
      .replace(/\.\w+$/, '')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return url;
  }
}
