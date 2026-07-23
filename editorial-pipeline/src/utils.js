import { createHash } from 'node:crypto';

export function cleanText(value) {
  return typeof value === 'string'
    ? value.replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')
    : '';
}

export function canonicalizeUrl(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href.replace(/\/$/, '');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function publisherFromUrl(value) {
  return new URL(value).hostname.replace(/^www\./, '');
}

export function dateHintFromUrl(value) {
  const pathname = new URL(value).pathname;
  const match = pathname.match(/\/(20\d{2})[/-](0[1-9]|1[0-2])[/-]([0-2]\d|3[01])(?:\/|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function extractionQuality(document) {
  const bodyLength = document.cleanedText.length;
  const signals = {
    hasTitle: Boolean(document.title),
    hasPublicationDate: Boolean(document.publishedAt),
    hasAuthor: Boolean(document.author),
    bodyCharacters: bodyLength,
    hasSubstantialBody: bodyLength >= 500
  };
  const score = Math.min(1, Number((
    (signals.hasTitle ? 0.2 : 0) +
    (signals.hasPublicationDate ? 0.15 : 0) +
    (signals.hasAuthor ? 0.1 : 0) +
    (signals.hasSubstantialBody ? 0.45 : Math.min(0.45, bodyLength / 500 * 0.45)) +
    (document.finalUrl ? 0.1 : 0)
  ).toFixed(2)));
  return { score, signals };
}

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function isCorruptedContent(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value || '');
  if (str.includes('\uFFFD')) return true;
  if (str.includes('ï¿½')) return true;
  if (/&#\d+;|&amp;#\d+;/.test(str)) return true;
  if (/[ÃÂÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]{3,}/.test(str)) return true;
  return false;
}

// A replacement character means the original bytes were already lost. It must
// be re-enriched from coreNews rather than silently removed by sanitization.
export function needsContentRefill(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value || '');
  return str.includes('\uFFFD') || str.includes('ï¿½');
}

export function cleanCorruptedText(value) {
  if (typeof value === 'string') {
    return value
      .replace(/&amp;/g, '&')
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;|&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/[\u200B\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(cleanCorruptedText);
  }
  if (typeof value === 'object' && value !== null) {
    const res = {};
    for (const [k, v] of Object.entries(value)) {
      res[k] = cleanCorruptedText(v);
    }
    return res;
  }
  return value;
}
