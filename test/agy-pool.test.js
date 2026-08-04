// Unit coverage for the native AGY profile pool. Nothing here spawns agy or
// touches the real keychain — those paths are exercised by
// `node src/agy/agy-cli.js doctor|test` against a live install.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The store roots off AGY_DATA_ROOT, so point it at a temp dir before the
// modules are imported and nothing can reach the operator's real profiles.
const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-pool-'));
process.env.AGY_DATA_ROOT = dataRoot;

const { classifyFailure, createSessionPool, PoolExhaustedError, resetProfile, setEnabled } =
  await import('../src/agy/session-pool.js');
const { buildAgyArgs, normalizeModel, DEFAULT_MODEL, KNOWN_MODELS } =
  await import('../src/agy/run-agent.js');
const { slugify } = await import('../src/agy/profile-store.js');
const { homeRedirectEnv, isSwapSupported, profileHome } = await import('../src/agy/paths.js');

test('display model names are translated to ids agy actually accepts', () => {
  // The repo previously passed these display names straight to --model.
  assert.equal(normalizeModel('Gemini 3.6 Flash (High)'), 'gemini-3.6-flash-high');
  assert.equal(normalizeModel('Gemini 3.6 Flash (Low)'), 'gemini-3.6-flash-low');
  assert.equal(normalizeModel('gemini-3.1-pro-high'), 'gemini-3.1-pro-high');
  assert.equal(normalizeModel(''), DEFAULT_MODEL);
  // An id from a future release must not be rewritten into something wrong.
  assert.equal(normalizeModel('gemini-4.0-ultra'), 'gemini-4.0-ultra');
  assert.ok(KNOWN_MODELS.includes(DEFAULT_MODEL));
});

test('agy args use the verified CLI 1.1.9 flag surface', () => {
  const args = buildAgyArgs({
    prompt: 'hello',
    model: 'Gemini 3.6 Flash (High)',
    outputFormat: 'json',
    jsonSchema: '{"type":"object"}',
    timeoutMs: 240000
  });
  assert.deepEqual(args, [
    '-p', 'hello',
    '--model', 'gemini-3.6-flash-high',
    '--dangerously-skip-permissions',
    '--output-format', 'json',
    '--json-schema', '{"type":"object"}',
    '--print-timeout', '240s'
  ]);
});

test('quota and auth failures are told apart, and unknown errors blame neither', () => {
  assert.equal(classifyFailure('Error: quota exceeded for this account'), 'quota');
  assert.equal(classifyFailure('RESOURCE_EXHAUSTED'), 'quota');
  assert.equal(classifyFailure('HTTP 429 Too Many Requests'), 'quota');
  // Observed verbatim from agy 1.1.9 with an unauthenticated HOME.
  assert.equal(classifyFailure('Error: Please sign in to view available models.'), 'auth');
  assert.equal(classifyFailure('unauthenticated'), 'auth');
  // A timeout is the request's fault — cooling a good account for it would
  // burn the pool on one slow article.
  assert.equal(classifyFailure('agy timed out after 240000ms'), 'unknown');
  assert.equal(classifyFailure('did not return a JSON object'), 'unknown');
});

test('HOME redirection targets the profile that owns the credential', () => {
  const home = profileHome('acct-one');
  assert.ok(home.startsWith(dataRoot));
  const env = homeRedirectEnv(home);
  if (process.platform === 'win32') {
    assert.equal(env.USERPROFILE, home);
  } else {
    // This is the mechanism the whole swap rests on: macOS resolves the login
    // keychain from $HOME/Library/Keychains.
    assert.equal(env.HOME, home);
    assert.equal(env.XDG_CONFIG_HOME, path.join(home, '.config'));
  }
});

test('an empty pool reports exhaustion instead of hanging', async () => {
  const pool = createSessionPool();
  await assert.rejects(() => pool.acquire(), (error) => {
    assert.ok(error instanceof PoolExhaustedError);
    assert.match(error.message, /No AGY profiles configured/);
    return true;
  });
});

test('pool bookkeeping survives a round trip through the state file', async () => {
  await setEnabled('ghost', false);
  const reset = await resetProfile('ghost');
  assert.equal(reset.status, 'ready');
  assert.equal(reset.coolUntil, 0);
  const state = JSON.parse(await fs.readFile(path.join(dataRoot, 'pool.json'), 'utf8'));
  assert.equal(state.profiles.ghost.status, 'ready');
});

test('profile names become safe directory slugs', () => {
  assert.equal(slugify('Work Account #2'), 'work-account-2');
  assert.equal(slugify('  eter.my  '), 'eter-my');
  assert.throws(() => slugify('!!!'), /at least one letter or digit/);
  // A slug is a directory name under the store root; path traversal must not survive.
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
});

test('platform support is reported honestly rather than assumed', () => {
  const { supported, reason } = isSwapSupported();
  if (process.platform === 'darwin') {
    assert.equal(supported, true);
    assert.equal(reason, null);
  } else {
    assert.equal(supported, false);
    assert.ok(reason);
  }
});

test.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
