import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo root is two directories up from src/config/env.js.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let loaded = false;

/**
 * Load key=value pairs from the gitignored .env at the repo root into
 * process.env. Existing (ambient) variables win, matching conventional dotenv
 * behaviour. Idempotent: safe to call from multiple entry points.
 */
export function loadEnv() {
  if (loaded) return;
  loaded = true;
  let text;
  try {
    text = fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8');
  } catch {
    return; // no .env — rely on the ambient environment
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key in process.env) continue; // do not clobber ambient values
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
