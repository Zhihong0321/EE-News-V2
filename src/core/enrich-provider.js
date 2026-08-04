// Shared enrichment-provider factory, used by both the editorial enrich CLI and
// the fetch->enrich->render orchestrator (pipeline.js). Kept in src/core so the
// orchestrator doesn't reach across into editorial-pipeline internals for it.
//
// Every provider here speaks the OpenAI standard: 'openai' is chat-completions
// (POST {base}/v1/chat/completions), 'cavoti' is the OpenAI Responses API.
import { createCavotiTerraProvider } from '../../editorial-pipeline/src/providers/cavoti-terra.js';
import { createOpenAiProvider } from '../../editorial-pipeline/src/providers/openai-chat.js';
import { chainFor } from './llm-registry.js';

/**
 * Wraps a primary provider and one or more fallbacks. If the primary provider
 * fails (e.g. quota limit reached, endpoint error), automatically fails over
 * to the next provider in sequence.
 */
export function createFallbackProvider(providers = []) {
  const activeProviders = providers.filter(Boolean);
  if (activeProviders.length === 0) throw new Error('At least one provider is required for createFallbackProvider');
  const primary = activeProviders[0];

  return {
    id: primary.id || 'fallback-chain',
    async enrich(prompt, article) {
      let lastError = null;

      for (const p of activeProviders) {
        try {
          const result = await p.enrich(prompt, article);
          return result;
        } catch (error) {
          lastError = error;
          console.warn(`[enrich-provider] provider "${p.id || 'unknown'}" failed: ${error.message}. Trying next fallback provider...`);
        }
      }

      throw new Error(`All providers in fallback chain failed: ${lastError?.message || 'unknown error'}`);
    }
  };
}

/**
 * @param {string} name   'openai' (default) | 'cavoti'
 * @param {object} [flags] { model }
 */
export function createProvider(name, flags = {}) {
  if (name === 'cavoti' || name === 'terra' || name === 'luna') {
    return createCavotiTerraProvider({ model: flags.model || 'gpt-5.6-terra' });
  }
  return createOpenAiProvider(flags.model ? { model: flags.model } : {});
}

/**
 * Enrichment provider honouring the factory's 'enrich' chain when one is
 * configured, falling back to createProvider(name) otherwise. Every routed
 * entry is usable — the chain and the enrichment provider now speak the same
 * OpenAI chat-completions standard, so there is nothing to skip.
 *
 * @param {string} name    provider name used when nothing is configured
 * @param {object} [flags] { model }
 */
export async function createProviderForTask(name, flags = {}) {
  let chain = [];
  try {
    chain = await chainFor('enrich');
  } catch (error) {
    console.warn(`[enrich-provider] enrich routing lookup failed, using "${name}": ${error.message}`);
  }
  if (!chain.length) return createProvider(name, flags);

  return createFallbackProvider(chain.map((entry) => createOpenAiProvider({
    baseUrl: entry.baseUrl,
    authToken: entry.token,
    model: entry.model
  })));
}
