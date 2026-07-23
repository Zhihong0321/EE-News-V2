import { retryFailedStages } from './retry-pipeline.js';

/**
 * Re-run distillation for articles whose 'distill' pipeline stage last failed
 * and are past their retry backoff window. Thin wrapper over the generic
 * stage-retry engine (see retry-pipeline.js) kept for the `npm run retry:distill`
 * CLI. Returns { attempted, succeeded, failed }.
 */
export async function retryFailedDistillation({ limit = 20 } = {}) {
  const { stages, ...totals } = await retryFailedStages({ stage: 'distill', limit });
  return totals;
}
