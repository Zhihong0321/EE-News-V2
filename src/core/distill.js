// Distills a fetched article (which may be in any language) into a short,
// English-only factual gist used as the comparison key for same-country,
// recent-window duplicate detection across sources.
//
// Distillation runs against MiniMax / Xiaomi MiMo, all exposed over the same
// Anthropic-compatible /v1/messages shape. A fallback CHAIN is tried in order
// (MiniMax -> MiMo 0730 -> MiMo 0726): the first provider that returns a
// non-empty gist wins, so a single provider being down/rate-limited no longer
// fails the whole distill stage. Base URLs and model ids are non-secret
// defaults below; the per-provider API keys come ONLY from the environment
// (gitignored .env), never from committed code:
//   DISTILL_MINIMAX_TOKEN     -> MiniMax-M3        @ api.minimax.io/anthropic
//   DISTILL_MIMO_0730_TOKEN   -> mimo-v2.5-pro     @ token-plan-sgp.xiaomimimo.com/anthropic
//   DISTILL_MIMO_0726_TOKEN   -> mimo-v2.5-pro     @ token-plan-sgp.xiaomimimo.com/anthropic
// Legacy single-provider config (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN /
// ANTHROPIC_MODEL, or explicit options.baseUrl/authToken) still works and is
// used as a final fallback when no DISTILL_* token is set.
import { loadEnv } from '../config/env.js';
import { report } from './llm-health.js';

loadEnv();

const XIAOMI_ANTHROPIC_BASE = 'https://token-plan-sgp.xiaomimimo.com/anthropic';

// Ordered fallback chain. Each entry is only used when its token env var is
// set, so the chain degrades gracefully to whatever credentials are present.
const PROVIDER_CHAIN = [
  { name: 'minimax', tokenEnv: 'DISTILL_MINIMAX_TOKEN', baseUrl: 'https://api.minimax.io/anthropic', model: 'MiniMax-M3' },
  { name: 'mimo-0730', tokenEnv: 'DISTILL_MIMO_0730_TOKEN', baseUrl: XIAOMI_ANTHROPIC_BASE, model: 'mimo-v2.5-pro' },
  { name: 'mimo-0726', tokenEnv: 'DISTILL_MIMO_0726_TOKEN', baseUrl: XIAOMI_ANTHROPIC_BASE, model: 'mimo-v2.5-pro' }
];

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Resolve the ordered list of { name, baseUrl, model, token } providers to try.
 * Explicit options.baseUrl/authToken force a single-provider run (used by
 * tests). Otherwise the DISTILL_* chain is used, falling back to the legacy
 * ANTHROPIC_* single provider when no chain token is configured.
 */
function resolveProviders(options = {}) {
  if (options.authToken || options.baseUrl) {
    return [{
      name: 'options',
      baseUrl: normalizeBase(options.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
      model: options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      token: options.authToken || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY
    }];
  }

  const providers = [];
  for (const entry of PROVIDER_CHAIN) {
    const token = process.env[entry.tokenEnv];
    if (token) providers.push({ name: entry.name, baseUrl: normalizeBase(entry.baseUrl), model: entry.model, token });
  }

  const legacyToken = process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (legacyToken) {
    providers.push({
      name: 'anthropic',
      baseUrl: normalizeBase(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'),
      model: options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      token: legacyToken
    });
  }

  if (!providers.length) {
    throw new Error('No distillation credentials configured (set DISTILL_MINIMAX_TOKEN / DISTILL_MIMO_0730_TOKEN / DISTILL_MIMO_0726_TOKEN, or ANTHROPIC_AUTH_TOKEN)');
  }
  return providers;
}

function clampWords(text, maxWords) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

function buildPrompt(article, maxWords) {
  const excerpt = String(article?.body || '').slice(0, 4000);
  return [
    'Read this news article, which may be written in any language, and distill',
    `it into a single factual gist of at most ${maxWords} words, in English.`,
    `Title: ${article?.title || ''}`,
    `Body excerpt: ${excerpt}`,
    '',
    'Lead with the core keywords first: the key people/organizations, the',
    'event or action, then supporting details (amounts, locations, dates) —',
    'not a narrative sentence. Keep specific entities, numbers, amounts,',
    'locations, and dates intact, do not generalize them away. No commentary',
    'or opinion. Return ONLY the gist as plain text: no quotes, no markdown,',
    'no preamble.'
  ].join('\n');
}

async function callProvider(provider, prompt, { fetchImpl, timeoutMs, maxWords }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(`${provider.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': provider.token,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: provider.model,
        // A 30-word gist plus the MiMo `thinking` block it emits by default
        // must both fit here; 128 starved the answer. See fix plan P0-B.1.
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
  } catch (error) {
    // Network failure or abort/timeout — no HTTP status to preserve. Report
    // per-provider so a single dead endpoint is visible on the factory page.
    report(provider.name, 'auto', { error, latencyMs: Date.now() - startedAt });
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const latencyMs = Date.now() - startedAt;
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = raw.slice(0, 200);
    try { message = JSON.parse(raw).error?.message || message; } catch { /* keep raw */ }
    const error = new Error(`Distillation provider returned HTTP ${response.status}: ${message}`);
    // Preserve THIS provider's status (e.g. a 401 dead key) instead of letting
    // it get merged into one generic error string by generateDigest.
    report(provider.name, 'auto', { status: response.status, error, latencyMs });
    throw error;
  }
  const payload = await response.json();
  // MiMo returns a `thinking` block alongside the answer; keep only `text`.
  const text = (payload.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
  const gist = clampWords(text, maxWords);
  if (!gist) {
    const error = new Error('Distillation model returned an empty gist');
    report(provider.name, 'auto', { status: response.status, error, latencyMs });
    throw error;
  }
  report(provider.name, 'auto', { status: response.status, latencyMs });
  return gist;
}

/**
 * Distill an article's title + body into a short (<= maxWords), English-only,
 * fact-focused gist (who/what/where/amount/date). Tries each configured
 * provider in order and returns the first non-empty gist. Callers should treat
 * this as best-effort: if every provider fails it throws (with each provider's
 * error), and the caller decides whether to fall back to null.
 */
export async function generateDigest(article, options = {}) {
  const providers = resolveProviders(options);
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 30000;
  const maxWords = options.maxWords || 30;
  const prompt = buildPrompt(article, maxWords);

  const errors = [];
  for (const provider of providers) {
    try {
      return await callProvider(provider, prompt, { fetchImpl, timeoutMs, maxWords });
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  throw new Error(`All distillation providers failed — ${errors.join(' | ')}`);
}
