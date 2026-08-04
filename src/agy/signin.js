// Launching an AGY sign-in from the factory UI.
//
// Sign-in cannot be done headlessly: agy only starts the Google OAuth flow when
// it is launched interactively with no arguments (verified — `agy models` on an
// unauthenticated HOME just prints "Please sign in ... Launch the CLI without
// arguments to sign in" and exits). So the server opens a real terminal window
// running agy under the profile's HOME, and the operator completes the sign-in
// there. The browser step is agy's own.
//
// The server never sees the credential: agy writes it straight into that
// profile's keychain. The UI just polls until the profile reports authenticated.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { agyDataRoot, homeRedirectEnv, isMac, profileHome, resolveAgyBinary } from './paths.js';

const run = promisify(execFile);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Open a terminal window running `agy` as `slug`. Returns what was launched so
 * the UI can show a copyable fallback command when the window cannot be opened
 * (headless host, SSH session, non-macOS).
 */
export async function launchSignIn(slug) {
  const bin = resolveAgyBinary();
  if (!bin) {
    throw new Error('agy CLI not found. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash');
  }
  const home = profileHome(slug);
  const env = homeRedirectEnv(home);
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join('\n');
  const manualCommand = `${Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ')} ${shellQuote(bin)}`;

  if (!isMac) {
    return { launched: false, manualCommand, reason: `Automatic terminal launch is macOS-only (this is ${process.platform}).` };
  }

  // A .command file rather than an inline AppleScript string: the profile path
  // is interpolated into a shell script either way, and a file keeps the
  // quoting in one place instead of nested through osascript.
  const scriptPath = path.join(agyDataRoot(), `signin-${slug}.command`);
  const script = `#!/bin/bash
${exports}
echo "Signing in to AGY profile: ${slug}"
echo "Use the Google account you want THIS profile to be."
echo "When the CLI is ready, type /quit to finish."
echo
${shellQuote(bin)}
echo
echo "Sign-in window finished. You can close this window."
`;
  await fs.mkdir(agyDataRoot(), { recursive: true, mode: 0o700 });
  await fs.writeFile(scriptPath, script, { mode: 0o700 });

  try {
    await run('open', ['-a', 'Terminal', scriptPath]);
    // Bring Terminal to the front. `open -a` alone can leave the window behind
    // the browser the operator is working in, which is exactly how a sign-in
    // prompt gets missed. Deliberately `open` rather than osascript: AppleScript
    // control of Terminal needs an automation permission grant, and when that
    // prompt is unanswered the call blocks until it times out.
    await run('open', ['-a', 'Terminal']).catch(() => {});
    return { launched: true, manualCommand, scriptPath };
  } catch (error) {
    return { launched: false, manualCommand, reason: `Could not open Terminal: ${error.message}` };
  }
}

/** Remove a leftover sign-in helper script. Best effort. */
export async function cleanupSignInScript(slug) {
  await fs.rm(path.join(agyDataRoot(), `signin-${slug}.command`), { force: true }).catch(() => {});
}
