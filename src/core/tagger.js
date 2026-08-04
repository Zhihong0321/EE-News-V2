// Assigns open-vocabulary topic tags to a fetched article using the same
// OpenAI-standard chat-completions endpoint as the rest of the pipeline
// (POST {base}/v1/chat/completions, Bearer auth). Credentials come ONLY from
// the environment:
//   OPENAI_BASE_URL  e.g. https://api.stepfun.com  (default: https://api.openai.com)
//   OPENAI_API_KEY   e.g. sk-...                   (sent as a Bearer token)
//   OPENAI_MODEL     e.g. step-3.7-flash           (overridable per call)
//
// FACTORY OVERRIDE: when the factory's LLM control plane has a chain configured
// for the 'tag' task, that chain replaces the env provider below. With nothing
// configured (or no database) the env provider is used unchanged.
import { loadEnv } from '../config/env.js';
import { report } from './llm-health.js';
import { chainFor, buildRequest, extractText } from './llm-registry.js';

loadEnv();

function cleanBaseUrl(url) {
  return String(url || '').replace(/\/+(?:v1)?\/*$/i, '');
}

let providerIndex = 0;

function getProviderPool(options = {}) {
  const token = options.authToken || process.env.OPENAI_API_KEY;
  if (!token) {
    throw new Error('No tagging credentials configured (set OPENAI_API_KEY, or route the tag task from the factory)');
  }
  return [{
    name: options.baseUrl || options.authToken ? 'custom' : 'openai',
    baseUrl: cleanBaseUrl(options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com'),
    token,
    model: options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  }];
}

function tryParseMetadataJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const attempt = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return { tags: parsed, country: null };
      if (parsed && typeof parsed === 'object') return parsed;
      return null;
    } catch {
      return null;
    }
  };
  const direct = attempt(trimmed);
  if (direct) return direct;
  const startObj = trimmed.indexOf('{');
  const endObj = trimmed.lastIndexOf('}');
  if (startObj >= 0 && endObj > startObj) {
    const res = attempt(trimmed.slice(startObj, endObj + 1));
    if (res) return res;
  }
  const startArr = trimmed.indexOf('[');
  const endArr = trimmed.lastIndexOf(']');
  if (startArr >= 0 && endArr > startArr) {
    const res = attempt(trimmed.slice(startArr, endArr + 1));
    if (res) return res;
  }
  return null;
}

function normalizeTags(list, maxTags) {
  const seen = new Set();
  const tags = [];
  for (const raw of list || []) {
    const tag = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= maxTags) break;
  }
  return tags;
}

function normalizeCountry(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Generate topic tags and detect primary subject country for an article via LLM call.
 * Returns { tags: string[], country: string | null }.
 */
export async function generateTagsAndCountry(article, options = {}) {
  const configured = (options.baseUrl || options.authToken) ? [] : await chainFor('tag');
  const pool = configured.length ? configured : getProviderPool(options);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 30000;
  const maxTags = options.maxTags || 8;

  const excerpt = String(article?.body || '').slice(0, 4000);
  const section = String(article?.section || '').trim();
  const prompt = [
    'Read this news article and analyze it for a news archive:',
    '1. Identify the primary subject country/territory that this news article is MAINLY about as a 2-letter ISO 3166-1 country code (e.g. "MY" for Malaysia, "CN" for China, "HK" for Hong Kong, "TW" for Taiwan, "SG" for Singapore, "ID" for Indonesia, "TH" for Thailand, "VN" for Vietnam, "JP" for Japan, "KR" for South Korea, "US" for United States, "GB" for United Kingdom, "IR" for Iran, "UA" for Ukraine, "RU" for Russia, etc.). If the article is global or covers multiple countries equally, return null.',
    `2. Assign up to ${maxTags} lowercase, hyphenated topic tags (e.g. "solar", "renewable-energy", "ev", "tech", "politics").`,
    '',
    `Title: ${article?.title || ''}`,
    section ? `Section/Category: ${section}` : '',
    `Body excerpt: ${excerpt}`,
    '',
    'Return ONLY a raw JSON object formatted exactly as:',
    '{"country": "ISO2_OR_NULL", "tags": ["tag1", "tag2"]}'
  ].filter(Boolean).join('\n');

  const errors = [];
  // Pick starting index in round-robin fashion
  const startIndex = providerIndex % pool.length;
  providerIndex = (providerIndex + 1) % pool.length;

  for (let i = 0; i < pool.length; i += 1) {
    const cred = pool[(startIndex + i) % pool.length];
    const model = options.model || cred.model || 'gpt-4o-mini';
    // 2048, not 512: reasoning models spend most of a small budget thinking and
    // return an empty answer. See the same note in distill.js.
    const request = buildRequest({ ...cred, model }, prompt, { maxTokens: 2048 });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal
      });

      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        let message = raw.slice(0, 200);
        try { message = JSON.parse(raw).error?.message || message; } catch { /* keep raw */ }
        throw new Error(`Tagging provider ${cred.name} returned HTTP ${response.status}: ${message}`);
      }
      const payload = await response.json();
      const parsed = tryParseMetadataJson(extractText(payload));
      if (!parsed) {
        throw new Error(`Tagging model ${cred.name} did not return valid metadata JSON`);
      }
      report(cred.name, 'auto', { status: response.status, latencyMs });

      const rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
      return {
        tags: normalizeTags(rawTags, maxTags),
        country: normalizeCountry(parsed.country)
      };
    } catch (error) {
      report(cred.name, 'auto', { error, latencyMs: Date.now() - startedAt });
      errors.push(`${cred.name}: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`All tagging providers failed — ${errors.join(' | ')}`);
}

/**
 * Legacy wrapper: Returns just the tags array.
 */
export async function generateTags(article, options = {}) {
  const result = await generateTagsAndCountry(article, options);
  return result.tags;
}
