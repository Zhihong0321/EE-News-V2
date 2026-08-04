// Cross-platform location of everything AGY-related: the CLI binary, the OS
// credential store that holds a session, and the directory this repo owns.
//
// Everything here was verified against agy CLI 1.1.9 on darwin_arm64 rather
// than inferred. The load-bearing finding:
//
//   AGY has no API key and no --account/--profile flag. A session is a token in
//   the OS credential store (macOS: keychain item service "gemini", account
//   "antigravity"). macOS resolves the login keychain from $HOME/Library/
//   Keychains, so redirecting HOME at spawn time changes WHICH credential agy
//   sees. Verified both directions: an empty sandbox HOME gives "Please sign in
//   to view available models", and the same sandbox with Library/Keychains
//   symlinked to the real one authenticates.
//
// That is the entire basis for profile isolation. Note it also means the
// ~/.gemini files are NOT credentials — copying them authenticates nothing.
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';

export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

/** Keychain coordinates of an AGY session, as observed on macOS. */
export const KEYCHAIN_SERVICE = 'gemini';
export const KEYCHAIN_ACCOUNT = 'antigravity';

/** Root this repo owns. Outside the project tree — profiles outlive checkouts. */
export function agyDataRoot() {
  if (process.env.AGY_DATA_ROOT) return path.resolve(process.env.AGY_DATA_ROOT);
  return path.join(os.homedir(), '.news-fetcher', 'agy');
}

/**
 * A profile's sandbox home. This is the profile — its Library/Keychains holds
 * that account's credential, and agy is spawned with HOME pointed here. Unlike
 * a copied secret it is never decrypted into a temp file: the OS keeps the
 * token encrypted at rest and we only ever hold the keychain password.
 */
export function profileHome(slug) {
  return path.join(agyDataRoot(), 'profiles', slug);
}

export function profileKeychainPath(slug) {
  return path.join(profileHome(slug), 'Library', 'Keychains', 'login.keychain-db');
}

export function profileMetaPath(slug) {
  return path.join(agyDataRoot(), 'profiles', slug, 'profile.json');
}

export function profilesRoot() {
  return path.join(agyDataRoot(), 'profiles');
}

export function poolStatePath() {
  return path.join(agyDataRoot(), 'pool.json');
}

/** Where each profile's keychain password is kept (mode 0600). */
export function secretsPath() {
  return path.join(agyDataRoot(), 'secrets.json');
}

/**
 * Candidate locations for the agy CLI, most specific first.
 *
 * macOS/Linux: the official installer (antigravity.google/cli/install.sh)
 * writes ~/.local/bin/agy — confirmed by running it.
 * Windows: install.ps1 writes %LOCALAPPDATA%\agy\bin\agy.exe — this is the path
 * the pre-existing provider already hardcoded, and the docs confirm it.
 */
export function agyBinaryCandidates() {
  const home = os.homedir();
  if (isWindows) {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return [
      path.join(localAppData, 'agy', 'bin', 'agy.exe'),
      path.join(home, '.local', 'bin', 'agy.exe')
    ];
  }
  return [
    path.join(home, '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/opt/homebrew/bin/agy'
  ];
}

/** First existing agy binary, or null. A dangling symlink counts as missing. */
export function resolveAgyBinary() {
  if (process.env.AGY_BIN) return process.env.AGY_BIN;
  return agyBinaryCandidates().find((candidate) => existsSync(candidate)) || null;
}

/**
 * Environment that makes one spawned agy read one profile's credential.
 *
 * On macOS the credential follows HOME because that is where Security resolves
 * the login keychain from; XDG_* and the CLI's own ~/.gemini state follow HOME
 * too, so conversation logs and caches stay per-profile as a side benefit.
 *
 * Windows uses Credential Manager, which is per-OS-user and NOT redirectable by
 * USERPROFILE. Profile isolation therefore cannot work this way on Windows —
 * isSwapSupported() reports that rather than letting a caller believe a swap
 * happened when every profile would resolve to the same account.
 */
export function homeRedirectEnv(home) {
  if (isWindows) {
    const parsed = path.parse(home);
    return {
      USERPROFILE: home,
      HOMEDRIVE: parsed.root.replace(/[\\/]$/, ''),
      HOMEPATH: home.slice(parsed.root.length - 1) || '\\',
      LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      APPDATA: path.join(home, 'AppData', 'Roaming')
    };
  }
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_CACHE_HOME: path.join(home, '.cache')
  };
}

/**
 * Whether per-profile credential isolation is possible on this platform.
 * Verified on macOS; unverified elsewhere, so callers get an explicit reason
 * instead of a silent single-account fallback.
 */
export function isSwapSupported() {
  if (isMac) return { supported: true, reason: null };
  if (isWindows) {
    return {
      supported: false,
      reason: 'Windows Credential Manager is per-OS-user and is not redirected by USERPROFILE, so one Windows login can hold only one AGY session.'
    };
  }
  return {
    supported: false,
    reason: `Profile isolation has only been verified on macOS; ${process.platform} uses the Secret Service API, which is per-desktop-session rather than per-HOME.`
  };
}
