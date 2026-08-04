// Distills a fetched article (which may be in any language) into a short,
// English-only factual gist used as the comparison key for same-country,
// recent-window duplicate detection across sources.
//
// Distillation runs against an OpenAI-standard chat-completions endpoint
// (POST {base}/v1/chat/completions, Bearer auth). Base URL and model id are
// non-secret and may be set in the environment; the API key comes ONLY from the
// environment (gitignored .env), never from committed code:
//   OPENAI_BASE_URL  e.g. https://api.stepfun.com   (default: https://api.openai.com)
//   OPENAI_API_KEY   e.g. sk-...
//   OPENAI_MODEL     e.g. step-3.7-flash
// Explicit options.baseUrl/authToken still force a single-provider run (tests).
//
// FACTORY OVERRIDE: when the factory's LLM control plane has a chain configured
// for the 'distill' task, that chain wins and the OPENAI_* fallback below is not
// consulted. With nothing configured (or no database) the env provider is used,
// so this file still works standalone.
import { loadEnv } from '../config/env.js';
import { report } from './llm-health.js';
import { chainFor, buildRequest, extractText } from './llm-registry.js';

loadEnv();

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Resolve the ordered list of { name, baseUrl, model, token } providers to try.
 * With no factory chain configured this is the single OPENAI_* provider from
 * the environment; explicit options.baseUrl/authToken override it.
 */
function resolveProviders(options = {}) {
  const token = options.authToken || process.env.OPENAI_API_KEY;
  if (!token) {
    throw new Error('No distillation credentials configured (set OPENAI_API_KEY, or route the distill task from the factory)');
  }
  return [{
    name: options.baseUrl || options.authToken ? 'options' : 'openai',
    baseUrl: normalizeBase(options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com'),
    model: options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    token
  }];
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
  // A 30-word gist plus the reasoning block some models emit by default must
  // both fit in max_tokens; 128 starved the answer (fix plan P0-B.1) and 512
  // still starves it for heavier reasoners — measured: StepFun step-3.7-flash
  // spends ~700 tokens thinking before emitting the gist, and returns a
  // thinking-only (empty-answer) response at 512. Now that operators can point
  // any model at this task from the factory, budget for the slowest.
  const request = buildRequest(provider, prompt, { maxTokens: 2048 });
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
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
  // Reasoning models return their thinking in a sibling `reasoning_content`
  // field; extractText keeps only the answer.
  const text = extractText(payload);
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
  // Factory-configured chain wins; an explicit options.baseUrl/authToken (tests)
  // still forces a single provider and bypasses both.
  const configured = (options.authToken || options.baseUrl) ? [] : await chainFor('distill');
  const providers = configured.length ? configured : resolveProviders(options);
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
