import { getAdapter } from './sites/index.js';
import { getCustomAdapter } from './sites/custom-registry.js';
import { runSite } from './core/runner.js';

const siteId = process.argv[2] || 'thestar';

async function resolveAdapter(id) {
  try {
    return getAdapter(id);
  } catch {
    const custom = await getCustomAdapter(id);
    if (!custom) throw new Error(`Unknown site "${id}"`);
    return custom;
  }
}

resolveAdapter(siteId).then(runSite).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
