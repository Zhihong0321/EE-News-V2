import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGenericAdapter } from './generic.js';

const CUSTOM_DIR = path.resolve(process.cwd(), 'src/sites/custom');
const ID_PATTERN = /^[a-z0-9-]+$/;

function slugPath(id) {
  return path.join(CUSTOM_DIR, `${id}.json`);
}

function isValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export function validateNewSiteInput(input, existingIds) {
  const errors = [];
  const id = String(input.id || '').trim().toLowerCase();
  const source = String(input.source || '').trim();
  const country = String(input.country || '').trim().toUpperCase();
  const latestUrl = String(input.latestUrl || '').trim();
  const timezone = String(input.timezone || '').trim() || 'Asia/Kuala_Lumpur';
  const listingArticleLinks = String(input.listingArticleLinks || '').trim();
  const articleLimit = Number.isFinite(Number(input.articleLimit)) && Number(input.articleLimit) > 0 ? Math.floor(Number(input.articleLimit)) : 3;
  const candidateLimit = Number.isFinite(Number(input.candidateLimit)) && Number(input.candidateLimit) > 0 ? Math.floor(Number(input.candidateLimit)) : Math.max(12, articleLimit * 4);

  if (!id || !ID_PATTERN.test(id)) errors.push('id must use lowercase letters, numbers, and hyphens only');
  if (id && existingIds.includes(id)) errors.push(`a site with id "${id}" already exists`);
  if (!source) errors.push('source name is required');
  if (!COUNTRY_PATTERN.test(country)) errors.push('country must be a 2-letter ISO 3166-1 code, e.g. MY, SG, ID');
  if (!latestUrl || !isValidUrl(latestUrl)) errors.push('listing URL must be a valid http(s) URL');
  if (!isValidTimezone(timezone)) errors.push(`"${timezone}" is not a recognized IANA timezone`);
  if (!listingArticleLinks) errors.push('a CSS selector for article links on the listing page is required');
  if (candidateLimit < articleLimit) errors.push('candidate limit must be greater than or equal to article limit');

  return {
    errors,
    config: {
      id,
      source,
      country,
      latestUrl,
      timezone,
      transport: { listing: 'playwright', article: 'playwright' },
      articleLimit,
      candidateLimit,
      selectors: { listingArticleLinks },
      addedVia: 'web-ui',
      addedAt: new Date().toISOString()
    }
  };
}

// Cache the parsed config set keyed on the custom dir's mtime so repeated
// registry lookups (one per HTTP request in server.js) don't re-read and
// re-parse every JSON file on disk each time. Adding/removing a file changes
// the dir mtime; in-app edits go through saveCustomConfig, which busts the cache.
let configCache = null;

export async function loadCustomConfigs() {
  await fs.mkdir(CUSTOM_DIR, { recursive: true });
  const dirMtimeMs = (await fs.stat(CUSTOM_DIR)).mtimeMs;
  if (configCache && configCache.mtimeMs === dirMtimeMs) return configCache.configs;

  const files = (await fs.readdir(CUSTOM_DIR)).filter((file) => file.endsWith('.json'));
  const configs = [];
  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(CUSTOM_DIR, file), 'utf8');
      configs.push(JSON.parse(raw));
    } catch (error) {
      console.warn(`Skipping unreadable custom site config ${file}: ${error.message}`);
    }
  }
  configs.sort((a, b) => a.id.localeCompare(b.id));
  configCache = { mtimeMs: dirMtimeMs, configs };
  return configs;
}

export async function listCustomAdapters() {
  const configs = await loadCustomConfigs();
  return configs.map(buildGenericAdapter);
}

export async function getCustomAdapter(id) {
  if (!ID_PATTERN.test(id)) return null;
  // Read only the single requested config rather than loading the whole dir.
  try {
    const raw = await fs.readFile(slugPath(id), 'utf8');
    return buildGenericAdapter(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveCustomConfig(config) {
  await fs.mkdir(CUSTOM_DIR, { recursive: true });
  await fs.writeFile(slugPath(config.id), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  configCache = null;
  return config;
}
