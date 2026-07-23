// Matches an article against same-country, recent-window candidates by
// comparing their distilled dedup_title gists (see distill.js). Plain
// token-overlap is enough because the gists are already normalized to short,
// keyword-first English — no embeddings/vector search needed at this volume.

function tokenize(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/**
 * Find the best-matching candidate for `article` among `candidates` (rows
 * shaped { id, url, source, dedup_title }), by Jaccard similarity of their
 * dedup_title token sets. Returns the best candidate plus its score, or null
 * when nothing clears `threshold`.
 */
export function findDuplicate(article, candidates, { threshold = 0.5 } = {}) {
  if (!article?.dedup_title || !Array.isArray(candidates) || candidates.length === 0) return null;
  const target = tokenize(article.dedup_title);
  let best = null;
  for (const candidate of candidates) {
    const score = jaccardSimilarity(target, tokenize(candidate.dedup_title));
    if (score >= threshold && (!best || score > best.score)) best = { ...candidate, score };
  }
  return best;
}
