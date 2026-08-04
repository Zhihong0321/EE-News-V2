#!/usr/bin/env node
// Operator CLI for the AGY profile pool.
//
//   node src/agy/agy-cli.js doctor              check install + swap support
//   node src/agy/agy-cli.js add <name>          create a profile, then sign in
//   node src/agy/agy-cli.js list                pool status
//   node src/agy/agy-cli.js test [slug]         run a real prompt through a profile
//   node src/agy/agy-cli.js reset <slug>        clear a cooldown / unauth mark
//   node src/agy/agy-cli.js enable|disable <slug>
//   node src/agy/agy-cli.js rm <slug>
import { spawn } from 'node:child_process';
import { homeRedirectEnv, isSwapSupported, profileHome, resolveAgyBinary } from './paths.js';
import {
  assertSearchListClean,
  createProfile,
  deleteProfile,
  isAuthenticated,
  markAuthenticated,
  unlockProfile
} from './profile-store.js';
import { poolStatus, resetProfile, setEnabled } from './session-pool.js';
import { DEFAULT_MODEL, KNOWN_MODELS, runAgyAgent } from './run-agent.js';

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

async function doctor() {
  const bin = resolveAgyBinary();
  const swap = isSwapSupported();
  console.log(`agy binary       : ${bin || 'NOT FOUND'}`);
  if (!bin) {
    console.log('  install with   : curl -fsSL https://antigravity.google/cli/install.sh | bash');
  }
  console.log(`platform         : ${process.platform}`);
  console.log(`profile swap     : ${swap.supported ? 'supported' : 'NOT supported'}`);
  if (!swap.supported) console.log(`  reason         : ${swap.reason}`);

  const search = await assertSearchListClean().catch((error) => ({ error: error.message }));
  if (search.error) console.log(`keychain search  : could not check (${search.error})`);
  else if (search.clean) console.log('keychain search  : clean (no profile keychains leaked into your session)');
  else console.log(`keychain search  : repaired ${search.repaired.length} leaked entry/entries`);

  const profiles = await poolStatus();
  console.log(`profiles         : ${profiles.length}`);
  for (const profile of profiles) console.log(`  - ${profile.slug} [${profile.status}]`);
  if (!profiles.length) console.log('  (none — run: node src/agy/agy-cli.js add <name>)');
}

async function list() {
  const profiles = await poolStatus();
  if (!profiles.length) {
    console.log('No profiles. Create one with: node src/agy/agy-cli.js add <name>');
    return;
  }
  for (const profile of profiles) {
    const cooling = profile.coolRemainingMs > 0 ? ` (${Math.ceil(profile.coolRemainingMs / 1000)}s left)` : '';
    const account = profile.account ? ` <${profile.account}>` : '';
    console.log(
      `${profile.slug.padEnd(20)} ${profile.status.padEnd(9)}${cooling}` +
      `${account}  calls=${profile.calls} failures=${profile.failures}`
    );
    if (profile.lastError) console.log(`  last error: ${profile.lastError.split('\n')[0]}`);
  }
}

/**
 * Create the profile, then hand the terminal to agy so the operator can sign in
 * with the Google account they want this profile to be. We never see or handle
 * the credential — agy writes it straight into the profile's own keychain.
 */
async function add(name) {
  if (!name) return fail('usage: agy-cli.js add <name>');
  const bin = resolveAgyBinary();
  if (!bin) return fail('agy CLI not found. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash');

  const profile = await createProfile(name);
  const home = profileHome(profile.slug);
  console.log(`Created profile "${profile.slug}"`);
  console.log(`  home     : ${home}`);
  console.log(`  keychain : ${profile.keychain}`);
  if (profile.searchListRepaired?.length) {
    console.log('  note     : removed the new keychain from your session search list (kept isolated)');
  }
  console.log('');
  console.log('Launching agy for sign-in. Use the Google account you want THIS profile to be.');
  console.log('When the CLI is ready, type /quit to return.');
  console.log('');

  await unlockProfile(profile.slug);
  await new Promise((resolve) => {
    const child = spawn(bin, [], {
      stdio: 'inherit',
      env: { ...process.env, ...homeRedirectEnv(home) },
      cwd: process.cwd()
    });
    child.on('close', resolve);
    child.on('error', (error) => {
      console.error(`Could not launch agy: ${error.message}`);
      resolve();
    });
  });

  if (await isAuthenticated(profile.slug)) {
    await markAuthenticated(profile.slug);
    console.log(`\n✓ Profile "${profile.slug}" is authenticated and in the pool.`);
  } else {
    console.log(
      `\n! Profile "${profile.slug}" still has no session. Re-run sign-in with:\n` +
      `    HOME=${home} ${bin}`
    );
  }
  await assertSearchListClean();
}

async function test(slug) {
  const profiles = await poolStatus();
  if (slug && !profiles.some((profile) => profile.slug === slug)) return fail(`No profile "${slug}"`);
  const model = process.env.AGY_MODEL || DEFAULT_MODEL;
  console.log(`Running a live prompt on model ${model}...`);
  try {
    const result = await runAgyAgent({
      prompt: 'Reply with exactly: AGY_OK',
      model,
      timeoutMs: 120000
    });
    console.log(`profile used : ${result.profile}`);
    console.log(`attempted    : ${result.attemptedProfiles.join(', ')}`);
    console.log(`reply        : ${result.text.trim().slice(0, 200)}`);
  } catch (error) {
    fail(`${error.message}${error.attemptedProfiles ? ` (tried: ${error.attemptedProfiles.join(', ')})` : ''}`);
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  switch (command) {
    case 'doctor': return doctor();
    case 'add': return add(argument);
    case 'list': case 'status': return list();
    case 'test': return test(argument);
    case 'models': return console.log(KNOWN_MODELS.join('\n'));
    case 'reset':
      if (!argument) return fail('usage: agy-cli.js reset <slug>');
      await resetProfile(argument);
      return console.log(`Profile "${argument}" reset to ready.`);
    case 'enable': case 'disable':
      if (!argument) return fail(`usage: agy-cli.js ${command} <slug>`);
      await setEnabled(argument, command === 'enable');
      return console.log(`Profile "${argument}" ${command}d.`);
    case 'rm': case 'remove':
      if (!argument) return fail('usage: agy-cli.js rm <slug>');
      return console.log(
        (await deleteProfile(argument))
          ? `Profile "${argument}" removed.`
          : `No profile "${argument}".`
      );
    default:
      console.log('Usage: node src/agy/agy-cli.js <doctor|add|list|test|models|reset|enable|disable|rm> [name]');
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
