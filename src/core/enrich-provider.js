// Shared enrichment-provider factory, used by both the editorial enrich CLI and
// the fetch->enrich->render orchestrator (pipeline.js). Kept in src/core so the
// orchestrator doesn't reach across into editorial-pipeline internals for it.
import { createCavotiTerraProvider } from '../../editorial-pipeline/src/providers/cavoti-terra.js';
import { createAnthropicProvider } from '../../editorial-pipeline/src/providers/anthropic-sonnet.js';
import { createAgyProvider } from '../../editorial-pipeline/src/providers/agy-gemini.js';
import { createClaudeCodeProvider } from '../../editorial-pipeline/src/providers/claude-code.js';

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
