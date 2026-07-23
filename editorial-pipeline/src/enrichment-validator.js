import { articleCutoffDate, enrichmentRelationships, styleBudgets } from './enrichment-prompt.js';

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isLocalized(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.en === 'string'
    && typeof value.zh === 'string';
}

// EN measured in whitespace words; ZH in CJK characters.
function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}
function cjkCount(text) {
  return (String(text || '').match(/[㐀-鿿豈-﫿]/g) || []).length;
}

// Source-relative "our country / 我国" deixis that is ambiguous to an
// international audience and must be resolved to a named place by the enricher.
const DEIXIS_PATTERNS = [
  { lang: 'zh', re: /我国|本国|我省|本省|我市|本市|我区|祖国|我们国家/ },
  { lang: 'ja', re: /我が国|わが国/ },
  { lang: 'ko', re: /우리\s?나라/ },
  { lang: 'en', re: /\b(our (country|nation|people|state)|the motherland|here at home)\b/i }
];

// Recursively collect every generated { en, zh } prose pair, skipping fields
// that legitimately preserve source text verbatim (originalTitle, urls, ids).
const DEIXIS_SKIP_KEYS = new Set(['originalTitle', 'sourceUrl', 'url', 'id', 'publisher', 'publishedAt', 'date']);
function collectPairs(node, pairs) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPairs(item, pairs);
    return;
  }
  if (isLocalized(node)) pairs.push(node);
  for (const [key, value] of Object.entries(node)) {
    if (DEIXIS_SKIP_KEYS.has(key)) continue;
    if (value && typeof value === 'object') collectPairs(value, pairs);
  }
}

export function validateEnrichment(article, content) {
  const errors = [];
  const warnings = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { valid: false, errors: ['Enrichment must be a JSON object'], warnings };
  }

  // A bilingual prose pair: both languages must exist and be non-empty.
  function requirePair(value, label) {
    if (!isLocalized(value)) {
      errors.push(`${label} must be a { en, zh } pair`);
      return false;
    }
    if (!value.en.trim()) errors.push(`${label} is missing English (en)`);
    if (!value.zh.trim()) errors.push(`${label} is missing Chinese (zh)`);
    return Boolean(value.en.trim()) && Boolean(value.zh.trim());
  }

  // Soft Signal-Style length budget — warnings only, never blocks.
  function checkBudget(value, budget, label) {
    if (!isLocalized(value) || !budget) return;
    if (wordCount(value.en) > budget.en) warnings.push(`${label} (en) over ${budget.en}-word target`);
    if (cjkCount(value.zh) > budget.zh) warnings.push(`${label} (zh) over ${budget.zh}-character target`);
  }

  // Core news: originalTitle & sourceUrl preserved verbatim; the rest bilingual.
  if (content.coreNews?.originalTitle !== article.title) errors.push('Core-news originalTitle was not preserved exactly');
  if (content.coreNews?.sourceUrl !== article.url) errors.push('Core-news sourceUrl was not preserved exactly');
  requirePair(content.coreNews?.displayTitle, 'Core-news displayTitle');
  checkBudget(content.coreNews?.displayTitle, styleBudgets.displayTitle, 'displayTitle');
  requirePair(content.coreNews?.summary, 'Core-news summary');
  checkBudget(content.coreNews?.summary, styleBudgets.summary, 'summary');

  if (!Array.isArray(content.coreNews?.keyFacts) || content.coreNews.keyFacts.length === 0) {
    errors.push('Core-news key facts are missing');
  } else {
    content.coreNews.keyFacts.forEach((fact, i) => {
      requirePair(fact?.text, `keyFacts[${i}].text`);
      checkBudget(fact?.text, styleBudgets.keyFact, `keyFacts[${i}]`);
    });
  }

  requirePair(content.centralInsight, 'centralInsight');
  requirePair(content.keyTakeaway, 'keyTakeaway');
  checkBudget(content.keyTakeaway, styleBudgets.keyTakeaway, 'keyTakeaway');

  if (!Array.isArray(content.dimensions) || content.dimensions.length === 0) {
    errors.push('At least one enrichment dimension is required');
  }
  if (!Array.isArray(content.sources) || content.sources.length === 0) {
    errors.push('At least the core source is required');
  }

  const sourceIds = new Set(['core']);
  for (const source of content.sources || []) {
    if (!source.id) {
      errors.push('A source is missing its ID');
      continue;
    }
    if (sourceIds.has(source.id) && source.id !== 'core') errors.push(`Duplicate source ID "${source.id}"`);
    sourceIds.add(source.id);
    if (!isHttpUrl(source.url)) errors.push(`Source "${source.id}" has an invalid URL`);
    requirePair(source.title, `Source "${source.id}" title`);
  }

  const referencedSources = [];
  for (const dimension of content.dimensions || []) {
    const dimLabel = isLocalized(dimension.title) ? dimension.title.en : (dimension.title || 'untitled');
    requirePair(dimension.title, `Dimension "${dimLabel}" title`);
    if (!enrichmentRelationships.has(dimension.relationship)) {
      errors.push(`Dimension "${dimLabel}" has invalid relationship "${dimension.relationship}"`);
    }
    requirePair(dimension.insight, `Dimension "${dimLabel}" insight`);
    checkBudget(dimension.insight, styleBudgets.insight, `Dimension "${dimLabel}" insight`);
    for (const fact of dimension.supportingFacts || []) {
      requirePair(fact.text, `Dimension "${dimLabel}" supporting fact`);
      if (fact.sourceId) referencedSources.push(fact.sourceId);
    }
    for (const metric of dimension.metrics || []) {
      if (!isLocalized(metric.label) || !isLocalized(metric.unit) || !isLocalized(metric.period)) {
        warnings.push(`Dimension "${dimLabel}" has a metric with a non-bilingual label/unit/period`);
      }
      if (metric.value !== null && typeof metric.value !== 'number') {
        errors.push(`A metric in "${dimLabel}" must use a numeric or null value`);
      }
      if (metric.comparisonValue !== null && typeof metric.comparisonValue !== 'number') {
        errors.push(`A metric in "${dimLabel}" has a non-numeric comparison value`);
      }
      if (metric.sourceId) referencedSources.push(metric.sourceId);
    }
  }

  for (const event of content.timeline || []) {
    requirePair(event.event, 'A timeline event');
    checkBudget(event.event, styleBudgets.timelineEvent, 'timeline event');
    if (event.sourceId) referencedSources.push(event.sourceId);
  }

  for (const item of content.whatToWatch || []) {
    requirePair(item, 'A whatToWatch item');
    checkBudget(item, styleBudgets.watchItem, 'whatToWatch item');
  }
  for (const item of content.uncertainties || []) {
    requirePair(item, 'An uncertainties item');
    checkBudget(item, styleBudgets.uncertainty, 'uncertainties item');
  }

  for (const sourceId of referencedSources) {
    if (!sourceIds.has(sourceId)) errors.push(`Unknown source reference "${sourceId}"`);
  }

  const cutoff = articleCutoffDate(article);
  for (const source of content.sources || []) {
    const sourceDate = String(source.publishedAt || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(sourceDate) && sourceDate.slice(0, 10) > cutoff) {
      errors.push(`Source "${source.id}" is newer than the ${cutoff} research cutoff`);
    }
  }

  // Geographic-neutrality check: flag unresolved first-person national deixis
  // ("我国" / "our country" / "我が国" / "우리나라") anywhere in generated prose.
  const pairs = [];
  collectPairs(content, pairs);
  const deixisHits = new Set();
  for (const pair of pairs) {
    for (const { lang, re } of DEIXIS_PATTERNS) {
      const target = lang === 'zh' || lang === 'ja' || lang === 'ko' ? pair.zh : pair.en;
      const match = String(target || '').match(re);
      if (match) deixisHits.add(match[0]);
    }
  }
  if (deixisHits.size > 0) {
    warnings.push(`Unresolved first-person place deixis (${[...deixisHits].join(', ')}) — resolve to the named country/place`);
  }

  if ((content.sources || []).length === 1) warnings.push('No external supporting sources were added');
  if ((content.dimensions || []).length > 8) warnings.push('More than eight dimensions may be too dense for one infographic');

  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
