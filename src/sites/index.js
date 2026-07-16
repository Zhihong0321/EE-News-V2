import { thestarAdapter } from './thestar.js';
import { sinchewAdapter } from './sinchew.js';
import { chinapressAdapter } from './chinapress.js';
import { theedgeAdapter } from './theedge.js';
import { utusanAdapter } from './utusan.js';

const adapters = {
  [thestarAdapter.id]: thestarAdapter,
  [sinchewAdapter.id]: sinchewAdapter,
  [chinapressAdapter.id]: chinapressAdapter,
  [theedgeAdapter.id]: theedgeAdapter,
  [utusanAdapter.id]: utusanAdapter
};

const requiredFields = ['id', 'source', 'latestUrl', 'timezone', 'articleLimit', 'candidateLimit', 'today', 'collectLinks', 'readArticle'];

export function validateAdapter(adapter) {
  const missing = requiredFields.filter((field) => adapter[field] === undefined || adapter[field] === null);
  const invalidNumbers = ['articleLimit', 'candidateLimit'].filter((field) => !Number.isInteger(adapter[field]) || adapter[field] <= 0);
  const invalidFunctions = ['today', 'collectLinks', 'readArticle'].filter((field) => typeof adapter[field] !== 'function');
  if (missing.length || invalidNumbers.length || invalidFunctions.length) {
    const details = [
      missing.length ? `missing: ${missing.join(', ')}` : '',
      invalidNumbers.length ? `invalid numbers: ${invalidNumbers.join(', ')}` : '',
      invalidFunctions.length ? `invalid functions: ${invalidFunctions.join(', ')}` : ''
    ].filter(Boolean).join('; ');
    throw new Error(`Invalid site adapter ${adapter?.id || 'unknown'}; ${details}`);
  }
  return adapter;
}

export function listAdapters() {
  return Object.values(adapters).map(validateAdapter);
}

export function getAdapter(id = 'thestar') {
  const adapter = adapters[id];
  if (!adapter) throw new Error(`Unknown site "${id}". Available sites: ${Object.keys(adapters).join(', ')}`);
  return validateAdapter(adapter);
}
