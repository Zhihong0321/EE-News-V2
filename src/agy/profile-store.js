// The native AGY auth store.
//
// A profile is a sandbox HOME whose Library/Keychains/login.keychain-db holds
// one Google account's AGY session. Spawning agy with HOME pointed at it makes
// that account the active one (see paths.js for the verification behind this).
//
// Deliberately NOT a secret-copying store: the token is written by agy's own
// sign-in, stays encrypted in a real macOS keychain, and this module never sees
// it. The only secret we hold is each profile's keychain password, and that is
// kept in the operator's own login keychain rather than in a file — so nothing
// here is a credential at rest that a backup of ~/.news-fetcher would expose.
//
// Verified: agy resolves the keychain from $HOME/Library/Keychains directly,
// NOT from the session search list. An empty sandbox HOME fails to authenticate
// even while the real login keychain is in the search list. That is why nothing
// in this file touches the global search list — and why assertSearchListClean()
// exists to catch it if some `security` subcommand ever does.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  isMac,
  isSwapSupported,
  profileHome,
  profileKeychainPath,
  profileMetaPath,
  profilesRoot
} from './paths.js';

const run = promisify(execFile);

/** Service name for the profile keychain passwords we stash in the real login keychain. */
const PASSWORD_SERVICE = 'news-fetcher-agy-profile';

export function slugify(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Profile name must contain at least one letter or digit');
  return slug;
}

function assertMac(action) {
  if (isMac) return;
  const { reason } = isSwapSupported();
  throw new Error(`Cannot ${action}: ${reason}`);
}

async function security(args, { allowFailure = false } = {}) {
  try {
    const { stdout, stderr } = await run('security', args, { encoding: 'utf8' });
    return { ok: true, stdout, stderr };
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: error.stdout || '', stderr: error.stderr || error.message };
    throw new Error(`security ${args[0]} failed: ${(error.stderr || error.message).trim()}`);
  }
}

/**
 * Read/persist a profile's keychain password via the operator's own login
 * keychain. First use may raise a macOS "allow access" prompt, which is the
 * correct behaviour — it is the OS asking whether this tool may hold the key.
 */
async function storePassword(slug, password) {
  await security([
    'add-generic-password',
    '-s', PASSWORD_SERVICE,
    '-a', slug,
    '-w', password,
    '-U', // update in place if it already exists
    '-D', 'news-fetcher AGY profile keychain password'
  ]);
}

async function readPassword(slug) {
  const result = await security(
    ['find-generic-password', '-s', PASSWORD_SERVICE, '-a', slug, '-w'],
    { allowFailure: true }
  );
  if (!result.ok) return null;
  return result.stdout.trim();
}

async function forgetPassword(slug) {
  await security(
    ['delete-generic-password', '-s', PASSWORD_SERVICE, '-a', slug],
    { allowFailure: true }
  );
}

/**
 * The global keychain search list is per-login-session, not per-HOME, so a
 * stray `security` call that appends to it would leak a profile's credential
 * into the operator's own session. Nothing here should ever change it; this
 * asserts that and repairs it if it happens.
 */
export async function assertSearchListClean() {
  const { stdout } = await security(['list-keychains']);
  const listed = stdout.split('\n').map((line) => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const leaked = listed.filter((entry) => entry.startsWith(profilesRoot()));
  if (!leaked.length) return { clean: true, repaired: [] };
  const kept = listed.filter((entry) => !entry.startsWith(profilesRoot()));
  await security(['list-keychains', '-s', ...kept]);
  return { clean: false, repaired: leaked };
}

async function readMeta(slug) {
  try {
    return JSON.parse(await fs.readFile(profileMetaPath(slug), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeMeta(slug, meta) {
  await fs.mkdir(profileHome(slug), { recursive: true, mode: 0o700 });
  await fs.writeFile(profileMetaPath(slug), `${JSON.stringify(meta, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Create an empty profile: sandbox HOME + a fresh unlocked keychain, ready for
 * `agy` to sign into. Does NOT authenticate — that needs an interactive Google
 * sign-in, which only the operator can do (see agy-cli.js `add`).
 */
export async function createProfile(name, { label = null } = {}) {
  assertMac('create an AGY profile');
  const slug = slugify(name);

  const existing = await readMeta(slug);
  if (existing) throw new Error(`Profile "${slug}" already exists`);

  const keychain = profileKeychainPath(slug);
  await fs.mkdir(profileHome(slug), { recursive: true, mode: 0o700 });
  await fs.mkdir(`${profileHome(slug)}/Library/Keychains`, { recursive: true, mode: 0o700 });

  const password = crypto.randomBytes(24).toString('base64');
  await security(['create-keychain', '-p', password, keychain]);
  // No -t and no -l: never auto-lock on a timer or on sleep. A batch enrich run
  // can span hours and a locked keychain would look exactly like an auth
  // failure, silently cooling a perfectly good profile.
  await security(['set-keychain-settings', keychain]);
  await security(['unlock-keychain', '-p', password, keychain]);
  await storePassword(slug, password);

  // create-keychain has been observed to append to the session search list on
  // some macOS versions. Undo it immediately rather than leaving the profile's
  // credential reachable from the operator's own session.
  const searchList = await assertSearchListClean();

  const meta = {
    slug,
    label: label || name,
    account: null,
    createdAt: new Date().toISOString(),
    authenticatedAt: null
  };
  await writeMeta(slug, meta);
  return { ...meta, keychain, searchListRepaired: searchList.repaired };
}

/**
 * Whether a profile actually holds an AGY session yet. Reads only the item's
 * existence — never its value.
 */
export async function isAuthenticated(slug) {
  if (!isMac) return false;
  const keychain = profileKeychainPath(slug);
  try {
    await fs.access(keychain);
  } catch {
    return false;
  }
  const result = await security(
    ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, keychain],
    { allowFailure: true }
  );
  return result.ok;
}

/** Unlock a profile's keychain. Cheap and idempotent; safe to call per run. */
export async function unlockProfile(slug) {
  const password = await readPassword(slug);
  if (!password) throw new Error(`No stored keychain password for profile "${slug}" — recreate it`);
  await security(['unlock-keychain', '-p', password, profileKeychainPath(slug)]);
}

/** Record that a profile signed in, and which account it landed on. */
export async function markAuthenticated(slug, account = null) {
  const meta = (await readMeta(slug)) || { slug, label: slug, createdAt: new Date().toISOString() };
  meta.account = account ?? meta.account ?? null;
  meta.authenticatedAt = new Date().toISOString();
  await writeMeta(slug, meta);
  return meta;
}

export async function listProfiles() {
  let entries;
  try {
    entries = await fs.readdir(profilesRoot(), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readMeta(entry.name);
    if (!meta) continue;
    profiles.push({ ...meta, authenticated: await isAuthenticated(entry.name) });
  }
  return profiles.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

export async function getProfile(slug) {
  const meta = await readMeta(slug);
  if (!meta) return null;
  return { ...meta, authenticated: await isAuthenticated(slug) };
}

export async function deleteProfile(slug) {
  const meta = await readMeta(slug);
  if (!meta) return false;
  await forgetPassword(slug);
  await fs.rm(profileHome(slug), { recursive: true, force: true });
  await assertSearchListClean();
  return true;
}
