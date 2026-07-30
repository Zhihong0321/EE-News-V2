// Shared enrichment-provider factory, used by both the editorial enrich CLI and
// the fetch->enrich->render orchestrator (pipeline.js). Kept in src/core so the
// orchestrator doesn't reach across into editorial-pipeline internals for it.
import { createCavotiTerraProvider } from '../../editorial-pipeline/src/providers/cavoti-terra.js';
import { createAnthropicProvider } from '../../editorial-pipeline/src/providers/anthropic-sonnet.js';
import { createAgyProvider } from '../../editorial-pipeline/src/providers/agy-gemini.js';
import { createClaudeCodeProvider } from '../../editorial-pipeline/src/providers/claude-code.js';
import { chainFor } from './llm-registry.js';

/**
 * Wraps a primary provider and one or more fallbacks. If the primary provider
 * fails (e.g. AGY quota limit reached, CLI process error), automatically fails over
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
 * @param {string} name   'agy'|'gemini' | 'claude'|'claude-code' | 'anthropic'|'sonnet' | 'cavoti' (default)
 * @param {object} [flags] { model }
 */
export function createProvider(name, flags = {}) {
  if (name === 'claude' || name === 'claude-code') {
    return createClaudeCodeProvider(flags);
  }
  if (name === 'anthropic' || name === 'sonnet') {
    return createAnthropicProvider({ model: flags.model || process.env.ANTHROPIC_MODEL || 'sonnet-5' });
  }
  if (name === 'cavoti' || name === 'terra' || name === 'luna') {
    return createCavotiTerraProvider({ model: flags.model || 'gpt-5.6-terra' });
  }
  if (name === 'agy' || name === 'gemini') {
    const agy = createAgyProvider(flags.model ? { model: flags.model } : {});
    const claude = createClaudeCodeProvider(flags);
    const cavoti = createCavotiTerraProvider({ model: 'gpt-5.6-terra' });
    const anthropic = createAnthropicProvider({ model: process.env.ANTHROPIC_MODEL || 'sonnet-5' });
    return createFallbackProvider([agy, claude, cavoti, anthropic]);
  }

  // Default: AGY with fallbacks to Claude Code, Cavoti (GPT-5.6 Terra/Luna), and Anthropic
  const agy = createAgyProvider(flags.model ? { model: flags.model } : {});
  const claude = createClaudeCodeProvider(flags);
  const cavoti = createCavotiTerraProvider({ model: 'gpt-5.6-terra' });
  const anthropic = createAnthropicProvider({ model: process.env.ANTHROPIC_MODEL || 'sonnet-5' });
  return createFallbackProvider([agy, claude, cavoti, anthropic]);
}

/**
 * Enrichment provider honouring the factory's 'enrich' chain when one is
 * configured, falling back to createProvider(name) otherwise.
 *
 * Enrichment is not a one-shot completion like distill/tag: it streams SSE,
 * uses server-side web search, and runs a research + finalize turn. Only the
 * Anthropic messages shape implements that here, so openai-style entries in the
 * chain are skipped with a warning rather than silently producing garbage. The
 * factory UI flags them for the same reason.
 *
 * @param {string} name    legacy provider name, used when nothing is configured
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

  const usable = [];
  for (const entry of chain) {
    if (entry.apiStyle !== 'anthropic') {
      console.warn(`[enrich-provider] skipping "${entry.name}/${entry.model}": enrichment needs an Anthropic-style endpoint, got "${entry.apiStyle}".`);
      continue;
    }
    usable.push(createAnthropicProvider({
      baseUrl: entry.baseUrl,
      authToken: entry.token,
      model: entry.model
    }));
  }
  if (!usable.length) {
    console.warn(`[enrich-provider] factory enrich chain had no Anthropic-style entries — falling back to "${name}".`);
    return createProvider(name, flags);
  }
  return createFallbackProvider(usable);
}
