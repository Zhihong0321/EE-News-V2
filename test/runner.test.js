import test from 'node:test';
import assert from 'node:assert/strict';
import { runSites } from '../src/core/runner.js';

test('empty site batches do not launch a browser', async () => {
  assert.deepEqual(await runSites([]), []);
});

test('invalid concurrency is rejected', async () => {
  await assert.rejects(() => runSites([], { concurrency: 0 }), /concurrency must be a positive integer/);
  await assert.rejects(() => runSites([], { concurrency: 1.5 }), /concurrency must be a positive integer/);
});
