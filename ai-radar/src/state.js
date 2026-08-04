// Per-source polling state: ETag/Last-Modified for conditional GET, and the set
// of URLs already seen.
//
// The seen-set is what makes dateless channels usable. Mistral's sitemap has no
// <lastmod>, so without a baseline the first run would report all 237 articles
// as breaking news. First run seeds; later runs report only genuinely new URLs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { radarConfig } from './config.js';

export async function loadState(statePath = radarConfig.statePath) {
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, sources: {} };
    throw error;
  }
}

export async function saveState(state, statePath = radarConfig.statePath) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  // Write-then-rename so an interrupted run cannot leave truncated JSON behind.
  const tmp = `${statePath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, statePath);
}

export function sourceState(state, sourceId) {
  return state.sources[sourceId] || { etag: null, lastModified: null, seen: [], firstRunAt: null };
}

export function updateSourceState(state, sourceId, patch) {
  const current = sourceState(state, sourceId);
  state.sources[sourceId] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  return state.sources[sourceId];
}

// Keeps the newest URLs and drops the tail, so state cannot grow without bound.
export function mergeSeen(previous, incoming) {
  const merged = [...incoming, ...previous];
  const unique = [];
  const seen = new Set();
  for (const url of merged) {
    if (seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
    if (unique.length >= radarConfig.maxSeenUrlsPerSource) break;
  }
  return unique;
}
