// In-memory per-provider LLM health registry (P0-A).
//
// Every LLM call (distill.js, tagger.js, and eventually the shared llm-client.js)
// reports its outcome here. The factory status endpoint reads snapshot() to show
// which keys are healthy, slow, rate-limited, or dead. This is deliberately
// process-local and dependency-free: health is live crawl telemetry, not
// something we persist.
//
// Contract (frozen for tracks A + C):
//   report(provider, outcome, { latencyMs, error, status })  -> void
//   classify({ status, error, latencyMs })                    -> state string
//   snapshot()                                                -> { generatedAt, providers[], overall }
//   reset()                                                   -> void   (tests)
//
// States: 'ok' | 'slow' | 'auth_error' | 'rate_limited' | 'timeout' | 'down'
// overall: 'ok' (all providers ok) | 'degraded' (any non-ok) | 'down' (all failing)

const ROLLING_WINDOW = 20;         // rolling success rate over last N calls
const SLOW_THRESHOLD_MS = 10_000;  // latency above this is 'slow' (plan P0-A)

const OK_STATES = new Set(['ok', 'slow']); // 'slow' still produced a result
const FAILING_STATES = new Set(['auth_error', 'rate_limited', 'timeout', 'down']);

/** @type {Map<string, ProviderHealth>} */
const registry = new Map();

/**
 * Derive a health state from raw call metadata. Callers may pass an explicit
 * outcome to report() instead; this is the fallback classifier and the single
 * source of truth for how HTTP status maps to state.
 */
export function classify({ status, error, latencyMs } = {}) {
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 429) return 'rate_limited';
  if (typeof status === 'number' && status >= 500) return 'down';
  if (typeof status === 'number' && status >= 400) return 'auth_error'; // 4xx client error = key/request broken, not transient
  if (error) {
    const msg = String(error && error.message ? error.message : error).toLowerCase();
    if (msg.includes('abort') || msg.includes('timed out') || msg.includes('timeout')) return 'timeout';
    return 'down'; // network / DNS / connection reset
  }
  if (typeof latencyMs === 'number' && latencyMs > SLOW_THRESHOLD_MS) return 'slow';
  return 'ok';
}

function blank(provider) {
  return {
    name: provider,
    state: 'ok',
    lastError: null,
    lastLatencyMs: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    _recent: [], // rolling window of booleans (true = ok/slow)
  };
}

/**
 * Record one provider call outcome.
 * @param {string} provider  e.g. 'openai' | 'stepfun' | 'tagger'
 * @param {string} [outcome] explicit state, or 'auto'/undefined to classify from meta
 * @param {{ latencyMs?: number, error?: any, status?: number }} [meta]
 */
export function report(provider, outcome, meta = {}) {
  if (!provider) return;
  const { latencyMs = null, error = null, status = null } = meta;
  const state = (!outcome || outcome === 'auto') ? classify({ status, error, latencyMs }) : outcome;

  const h = registry.get(provider) || blank(provider);
  h.state = state;
  h.lastLatencyMs = latencyMs;

  const succeeded = OK_STATES.has(state);
  if (succeeded) {
    h.lastSuccessAt = new Date().toISOString();
    h.consecutiveFailures = 0;
    if (state === 'ok') h.lastError = null;
  } else {
    h.consecutiveFailures += 1;
    h.lastError = error ? String(error && error.message ? error.message : error) : (status ? `HTTP ${status}` : state);
  }

  h._recent.push(succeeded);
  if (h._recent.length > ROLLING_WINDOW) h._recent.shift();

  registry.set(provider, h);
}

function successRate(recent) {
  if (!recent.length) return 1;
  const ok = recent.reduce((n, b) => n + (b ? 1 : 0), 0);
  return Math.round((ok / recent.length) * 100) / 100;
}

/** Point-in-time view for the factory dashboard. */
export function snapshot() {
  const providers = [...registry.values()].map((h) => ({
    name: h.name,
    state: h.state,
    lastError: h.lastError,
    lastLatencyMs: h.lastLatencyMs,
    successRate: successRate(h._recent),
    consecutiveFailures: h.consecutiveFailures,
    lastSuccessAt: h.lastSuccessAt,
  }));

  let overall = 'ok';
  if (providers.length) {
    const allFailing = providers.every((p) => FAILING_STATES.has(p.state));
    const anyBad = providers.some((p) => p.state !== 'ok');
    overall = allFailing ? 'down' : anyBad ? 'degraded' : 'ok';
  }

  return { generatedAt: new Date().toISOString(), providers, overall };
}

/** Test hook. */
export function reset() {
  registry.clear();
}

/**
 * @typedef {Object} ProviderHealth
 * @property {string} name
 * @property {string} state
 * @property {string|null} lastError
 * @property {number|null} lastLatencyMs
 * @property {string|null} lastSuccessAt
 * @property {number} consecutiveFailures
 * @property {boolean[]} _recent
 */
