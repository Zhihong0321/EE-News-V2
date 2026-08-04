// Rotation across AGY profiles: who is ready, who is cooling down, and which
// profile the next call should use.
//
// This is the piece low-legion's run-agy-agent.mjs owned. Bringing it in-repo
// means the provider can see pool state instead of pattern-matching another
// process's stderr for "All agy sessions exhausted".
//
// Leases are in-process. Two separate node processes enriching at the same time
// can hand the same profile to concurrent calls — acceptable because agy itself
// tolerates it (each spawn is an independent request against the same account),
// and the failure mode is quota pressure, not corruption. The persisted file is
// cooldown/counters only, so a concurrent writer can at worst lose a counter
// increment, never a credential.
import fs from 'node:fs/promises';
import path from 'node:path';
import { poolStatePath } from './paths.js';
import { isAuthenticated, listProfiles } from './profile-store.js';

/** How long a profile sits out after a quota rejection. */
export const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

export class PoolExhaustedError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'PoolExhaustedError';
    this.poolExhausted = true;
    Object.assign(this, detail);
  }
}

/**
 * Classify an agy failure so the pool knows whether to cool the profile, retire
 * it, or blame the request.
 *
 * NOTE: the quota/auth patterns below are matched against agy 1.1.9's stderr
 * but have NOT been observed against a real quota rejection — reaching one
 * requires exhausting an account. They are deliberately broad, and additional
 * patterns can be supplied via AGY_QUOTA_PATTERN / AGY_AUTH_PATTERN without a
 * code change. `unknown` never cools a profile, so a misclassification costs a
 * retry rather than silently retiring a working account.
 */
export function classifyFailure(text) {
  const message = String(text || '');
  const extraQuota = process.env.AGY_QUOTA_PATTERN;
  const extraAuth = process.env.AGY_AUTH_PATTERN;

  const authPatterns = [
    /please sign in/i,
    /not (?:signed|logged) in/i,
    /unauthenticated/i,
    /invalid credentials/i,
    /token (?:has )?expired/i,
    /\b401\b/
  ];
  const quotaPatterns = [
    /quota/i,
    /rate.?limit/i,
    /resource[_ ]exhausted/i,
    /too many requests/i,
    /out of (?:credits|ai credits)/i,
    /\b429\b/
  ];

  if (extraAuth && new RegExp(extraAuth, 'i').test(message)) return 'auth';
  if (extraQuota && new RegExp(extraQuota, 'i').test(message)) return 'quota';
  // Auth first: "please sign in" is unambiguous, whereas a quota message can
  // mention credits and auth in the same breath.
  if (authPatterns.some((pattern) => pattern.test(message))) return 'auth';
  if (quotaPatterns.some((pattern) => pattern.test(message))) return 'quota';
  return 'unknown';
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(poolStatePath(), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { profiles: {} };
    throw error;
  }
}

async function writeState(state) {
  const target = poolStatePath();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target); // atomic: a reader never sees a half file
  return state;
}

function entryFor(state, slug) {
  if (!state.profiles[slug]) {
    state.profiles[slug] = {
      status: 'ready', coolUntil: 0, lastError: null, calls: 0, failures: 0, lastUsedAt: 0
    };
  }
  return state.profiles[slug];
}

/**
 * Pool state joined with the profiles that actually exist on disk. A profile
 * whose keychain holds no session is reported `unauth` regardless of what the
 * state file says — the disk is the truth, the file is only bookkeeping.
 */
export async function poolStatus() {
  const [profiles, state] = await Promise.all([listProfiles(), readState()]);
  const now = Date.now();
  return profiles.map((profile) => {
    const entry = entryFor(state, profile.slug);
    let status = entry.status;
    if (!profile.authenticated) status = 'unauth';
    else if (status === 'cooling' && entry.coolUntil <= now) status = 'ready';
    return {
      slug: profile.slug,
      label: profile.label,
      account: profile.account,
      status,
      coolUntil: entry.coolUntil,
      coolRemainingMs: Math.max(0, entry.coolUntil - now),
      lastError: entry.lastError,
      calls: entry.calls,
      failures: entry.failures,
      lastUsedAt: entry.lastUsedAt
    };
  });
}

export function createSessionPool({ cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
  const leased = new Set();
  const waiters = [];

  async function readyProfiles() {
    const status = await poolStatus();
    return status.filter((profile) => profile.status === 'ready');
  }

  async function pick() {
    const ready = await readyProfiles();
    const free = ready.filter((profile) => !leased.has(profile.slug));
    if (!free.length) return { profile: null, anyReady: ready.length > 0 };
    // Least-recently-used: spreads load so one account is not burned down while
    // the others sit idle accumulating nothing.
    free.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    return { profile: free[0], anyReady: true };
  }

  return {
    /**
     * Lease a ready profile. Waits when every ready profile is busy; throws
     * PoolExhaustedError when there is nothing to wait for, so the caller can
     * fail over to another provider immediately instead of blocking.
     */
    async acquire() {
      for (;;) {
        const { profile, anyReady } = await pick();
        if (profile) {
          leased.add(profile.slug);
          return profile;
        }
        if (!anyReady) {
          const all = await poolStatus();
          if (!all.length) {
            throw new PoolExhaustedError(
              'No AGY profiles configured. Run: node src/agy/agy-cli.js add <name>'
            );
          }
          const unauth = all.filter((entry) => entry.status === 'unauth').map((entry) => entry.slug);
          const cooling = all.filter((entry) => entry.status === 'cooling');
          const soonest = cooling.length ? Math.min(...cooling.map((entry) => entry.coolRemainingMs)) : 0;
          throw new PoolExhaustedError(
            `All AGY profiles exhausted (${all.length} total, ${cooling.length} cooling, ${unauth.length} unauthenticated)` +
            (cooling.length ? `; next ready in ${Math.ceil(soonest / 1000)}s` : ''),
            { unauthenticated: unauth, coolingCount: cooling.length }
          );
        }
        // Every ready profile is leased: wait for one to come back.
        await new Promise((resolve) => waiters.push(resolve));
      }
    },

    async release(slug) {
      leased.delete(slug);
      const waiter = waiters.shift();
      if (waiter) waiter();
    },

    /** Record a successful call. */
    async succeed(slug) {
      const state = await readState();
      const entry = entryFor(state, slug);
      entry.calls += 1;
      entry.lastUsedAt = Date.now();
      entry.status = 'ready';
      entry.lastError = null;
      await writeState(state);
      await this.release(slug);
    },

    /**
     * Record a failure and apply the consequence: quota cools the profile,
     * auth retires it until re-signed-in, anything else leaves it ready.
     */
    async fail(slug, error) {
      const message = String(error?.agyOutput || error?.message || error || '');
      const kind = classifyFailure(message);
      const state = await readState();
      const entry = entryFor(state, slug);
      entry.failures += 1;
      entry.lastUsedAt = Date.now();
      entry.lastError = message.slice(0, 300);
      if (kind === 'quota') {
        entry.status = 'cooling';
        entry.coolUntil = Date.now() + cooldownMs;
      } else if (kind === 'auth') {
        entry.status = 'unauth';
        entry.coolUntil = 0;
      }
      await writeState(state);
      await this.release(slug);
      return kind;
    }
  };
}

/** Clear a cooldown / unauth mark, e.g. after re-authenticating. */
export async function resetProfile(slug) {
  const state = await readState();
  const entry = entryFor(state, slug);
  entry.status = 'ready';
  entry.coolUntil = 0;
  entry.lastError = null;
  await writeState(state);
  return entry;
}

export async function setEnabled(slug, enabled) {
  const state = await readState();
  const entry = entryFor(state, slug);
  entry.status = enabled ? 'ready' : 'disabled';
  if (enabled) entry.coolUntil = 0;
  await writeState(state);
  return entry;
}
