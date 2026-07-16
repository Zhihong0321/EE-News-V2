import { getAdapter } from './sites/index.js';
import { runSite } from './core/runner.js';

const siteId = process.argv[2] || 'thestar';

runSite(getAdapter(siteId)).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
