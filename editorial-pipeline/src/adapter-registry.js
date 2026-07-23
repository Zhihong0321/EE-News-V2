import { listAdapters } from '../../src/sites/index.js';
import { listCustomAdapters } from '../../src/sites/custom-registry.js';

function domainMatches(url, adapter) {
  const requested = new URL(url).hostname.replace(/^www\./, '');
  const configured = new URL(adapter.latestUrl).hostname.replace(/^www\./, '');
  return requested === configured || requested.endsWith(`.${configured}`);
}

export async function listResearchAdapters() {
  const adapters = [...listAdapters(), ...await listCustomAdapters()];
  const seen = new Set();
  return adapters.filter((adapter) => {
    if (seen.has(adapter.id)) return false;
    seen.add(adapter.id);
    return true;
  });
}

export async function findAdapterForUrl(url) {
  return (await listResearchAdapters()).find((adapter) => domainMatches(url, adapter)) || null;
}
