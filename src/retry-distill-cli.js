#!/usr/bin/env node
import { retryFailedDistillation } from './core/retry-distill.js';

retryFailedDistillation().then((summary) => {
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}).catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
