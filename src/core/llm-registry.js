// Runtime read path for the factory-managed LLM control plane.
//
// distill.js, tagger.js, and enrich-provider.js ask this module "who runs task
// X?" instead of hard-coding a provider chain. Two rules keep this safe:
//
//   1. FALLBACK IS ALWAYS AVAILABLE. If no database is configured, the tables
//      are empty, or the lookup throws, chainFor() returns [] and every caller
//      keeps using the env-based chain it shipped with. Configuring the factory
//      is an override, never a prerequisite (guiding principle #1: a dead or
//      unconfigured LLM control plane must not fail the crawl).
//   2. CACHED, NOT PER-CALL. A crawl enriches many articles in a row; hitting
//      Postgres for routing on every article would be silly. The chain is
//      cached for CACHE_MS and invalidated explicitly by the factory API
//      whenever a provider/model/route is written.
import { resolveTaskChain } from '../db/llm-config.js';
import { isDbEnabled } from '../db/pool.js';

const CACHE_MS = 30_000;

/** @type {Map<string, { at: number, chain: any[] }>} */
const cache = new Map();

/** Drop cached routing so the next call re-reads the DB. Called after writes. */
export function invalidate(task) {
  if (task) cache.delete(task);
  else cache.clear();
}

/**
 * Ordered, ready-to-call provider chain for a task, or [] when the factory has
 * nothing configured for it. Never throws — a broken control plane degrades to
 * the caller's legacy chain rather than taking the pipeline down.
 *
 * @param {'distill'|'tag'|'enrich'} task
 * @returns {Promise<Array<{name,apiStyle,baseUrl,token,model}>>}
 */
export async function chainFor(task) {
  if (!isDbEnabled()) return [];
  const hit = cache.get(task);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.chain;
  try {
    const chain = await resolveTaskChain(task);
    cache.set(task, { at: Date.now(), chain });
    return chain;
  } catch (error) {
    console.warn(`[llm-registry] routing lookup for "${task}" failed, using built-in chain: ${error.message}`);
    cache.set(task, { at: Date.now(), chain: [] });
    return [];
  }
}

/**
 * Build the endpoint URL, headers, and body for one provider entry, so
 * anthropic-style and openai-style endpoints can be called through one code
 * path. `maxTokens` must be generous enough to cover reasoning blocks that some
 * models emit before the answer (see distill.js: 128 starved the gist).
 */
export function buildRequest(provider, prompt, { maxTokens = 512 } = {}) {
  if (provider.apiStyle === 'openai') {
    return {
      url: `${provider.baseUrl}/v1/chat/completions`,
      headers: {
        authorization: `Bearer ${provider.token}`,
        'content-type': 'application/json'
      },
      body: {
        model: provider.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      }
    };
  }
  return {
    url: `${provider.baseUrl}/v1/messages`,
    headers: {
      'x-api-key': provider.token,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: {
      model: provider.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    }
  };
}

/**
 * Pull the assistant's plain text out of either response shape, discarding
 * reasoning/thinking blocks (MiMo emits `thinking`, StepFun and friends emit
 * `reasoning_content`) so callers only ever see the answer.
 */
export function extractText(payload, apiStyle) {
  if (apiStyle === 'openai') {
    return String(payload?.choices?.[0]?.message?.content || '');
  }
  return (payload?.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}
