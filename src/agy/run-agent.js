// Native replacement for low-legion's run-agy-agent.mjs: run one prompt through
// agy on a pooled profile, rotating to the next account when one is rejected.
//
// Flags used here were read off `agy --help` on CLI 1.1.9, not assumed:
//   -p <prompt>                     single non-interactive prompt, prints reply
//   --model <id>                    e.g. gemini-3.6-flash-high
//   --output-format text|json|stream-json
//   --json-schema <string|path>     enforce structured output
//   --print-timeout <duration>      Go duration, default 5m0s
//   --dangerously-skip-permissions  auto-approve tool permission prompts
import { spawn } from 'node:child_process';
import { homeRedirectEnv, isSwapSupported, profileHome, resolveAgyBinary } from './paths.js';
import { PoolExhaustedError, classifyFailure, createSessionPool, poolStatus } from './session-pool.js';
import { unlockProfile } from './profile-store.js';

export const DEFAULT_MODEL = 'gemini-3.6-flash-high';

/**
 * Model ids as reported by `agy models` on CLI 1.1.9. Kept here so callers can
 * be told what is valid instead of discovering it through a failed run.
 */
export const KNOWN_MODELS = [
  'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
  'gemini-3.5-flash-high', 'gemini-3.5-flash-medium', 'gemini-3.5-flash-low',
  'gemini-3.1-pro-high', 'gemini-3.1-pro-low',
  'claude-sonnet-4-6', 'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium'
];

/**
 * Translate the human-readable model names this repo used to pass (e.g.
 * "Gemini 3.6 Flash (High)") into the ids agy actually accepts. Those display
 * names are not valid --model values; they were only ever understood by the
 * external runner. Unknown values pass through so a new model id from a future
 * release is not blocked by this table.
 */
export function normalizeModel(model) {
  const raw = String(model || '').trim();
  if (!raw) return DEFAULT_MODEL;
  if (KNOWN_MODELS.includes(raw)) return raw;

  const canonical = raw
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '-');
  if (KNOWN_MODELS.includes(canonical)) return canonical;

  const match = canonical.match(/^(gemini|claude|gpt)[-_]?(.*)$/);
  if (match) {
    const collapsed = canonical.replace(/-+/g, '-');
    const hit = KNOWN_MODELS.find((known) => known === collapsed);
    if (hit) return hit;
  }
  return raw;
}

function goDuration(ms) {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

export function buildAgyArgs({ prompt, model, outputFormat, jsonSchema, timeoutMs, addDirs = [] }) {
  const args = ['-p', prompt, '--model', normalizeModel(model), '--dangerously-skip-permissions'];
  if (outputFormat) args.push('--output-format', outputFormat);
  if (jsonSchema) args.push('--json-schema', jsonSchema);
  if (timeoutMs) args.push('--print-timeout', goDuration(timeoutMs));
  for (const dir of addDirs) args.push('--add-dir', dir);
  return args;
}

/** One agy spawn against one profile. Resolves with stdout, rejects with stderr attached. */
function spawnAgy({ bin, args, home, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // home === null means "ambient": inherit the operator's own signed-in
    // session rather than redirecting into a profile.
    const env = {
      ...process.env,
      ...(home ? homeRedirectEnv(home) : {}),
      // agy writes UTF-8; the pipeline handles Chinese copy and a mismatched
      // console codepage is how mojibake got into packets before.
      PYTHONIOENCODING: 'utf-8',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    };
    let child;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, cwd, env });
    } catch (error) {
      reject(new Error(`agy spawn failed (AGY_BIN=${bin}): ${error.message}`));
      return;
    }
    const stdout = [];
    const stderr = [];
    // Kill slightly after agy's own --print-timeout so its error message wins
    // and we can classify it, rather than every timeout looking identical.
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(`agy timed out after ${timeoutMs}ms`);
      error.name = 'AbortError';
      reject(error);
    }, timeoutMs + 15000);

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`agy spawn failed: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) return resolve(out);
      const agyOutput = (err || out).trim();
      const error = new Error(`agy failed (exit ${code}): ${agyOutput.slice(0, 300)}`);
      error.agyOutput = agyOutput;
      reject(error);
    });
  });
}

/**
 * Run one prompt, rotating across profiles on quota/auth rejection.
 *
 * Rotation only retries failures that are the PROFILE's fault. A timeout or a
 * malformed reply is the request's fault and retrying it on a fresh account
 * would burn the whole pool on one bad article.
 */
export async function runAgyAgent({
  prompt,
  model = DEFAULT_MODEL,
  cwd = process.cwd(),
  timeoutMs = 240000,
  outputFormat = null,
  jsonSchema = null,
  addDirs = [],
  pool = null
} = {}) {
  const { supported, reason } = isSwapSupported();
  const bin = resolveAgyBinary();
  if (!bin) {
    throw new Error(
      'agy CLI not found. Install it with: curl -fsSL https://antigravity.google/cli/install.sh | bash'
    );
  }

  const sessionPool = pool || createSessionPool();
  const args = buildAgyArgs({ prompt, model, outputFormat, jsonSchema, timeoutMs, addDirs });
  const attempted = [];
  let lastError = null;

  // No profiles configured: use whatever account is signed in on this machine,
  // exactly as the CLI behaves by hand. Without this, adopting the native
  // runner would break every host that has not built a pool yet — the pool is
  // an upgrade to rotation, not a precondition for running at all.
  if (!(await poolStatus()).length) {
    const text = await spawnAgy({ bin, args, home: null, cwd, timeoutMs });
    return { text, profile: null, ambient: true, attemptedProfiles: [] };
  }

  for (;;) {
    let profile;
    try {
      profile = await sessionPool.acquire();
    } catch (error) {
      if (error instanceof PoolExhaustedError && lastError) {
        lastError.poolExhausted = true;
        lastError.attemptedProfiles = attempted;
        throw lastError;
      }
      if (error instanceof PoolExhaustedError && !supported) error.message += ` (${reason})`;
      throw error;
    }

    attempted.push(profile.slug);
    try {
      // A keychain that locked (reboot, or an OS policy we did not set) reads
      // exactly like a signed-out account, so unlock before every run.
      await unlockProfile(profile.slug);
      const text = await spawnAgy({ bin, args, home: profileHome(profile.slug), cwd, timeoutMs });
      await sessionPool.succeed(profile.slug);
      return { text, profile: profile.slug, attemptedProfiles: attempted };
    } catch (error) {
      const kind = await sessionPool.fail(profile.slug, error);
      lastError = error;
      if (kind === 'quota' || kind === 'auth') continue; // rotate
      error.attemptedProfiles = attempted;
      throw error; // request's fault — do not burn another account on it
    }
  }
}

/** Whether the native pool can be used at all, with a reason when it cannot. */
export async function nativeRunnerAvailable() {
  const bin = resolveAgyBinary();
  if (!bin) return { available: false, reason: 'agy CLI is not installed' };
  const { supported, reason } = isSwapSupported();
  if (!supported) return { available: false, reason, bin };
  return { available: true, bin, reason: null };
}

export { classifyFailure, PoolExhaustedError };
