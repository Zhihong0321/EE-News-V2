import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPipelineDashboard,
  recordStageStatusWithClient
} from '../src/db/pipeline-status.js';

test('pending stage updates preserve the existing attempt count', async () => {
  const calls = [];
  const client = {
    async query(text, params) {
      calls.push({ text, params });
    }
  };

  await recordStageStatusWithClient(client, 42, 'enrich', 'pending');

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [42, 'enrich']);
  assert.match(calls[0].text, /status\s*=\s*'pending'/);
  const conflictUpdate = calls[0].text.split('do update set')[1];
  assert.doesNotMatch(conflictUpdate, /attempts\s*=/);
});

test('pipeline dashboard is an empty optional feature without a database', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_DB_URL;
  try {
    assert.deepEqual(await getPipelineDashboard(), {
      enabled: false,
      counts: [],
      articles: []
    });
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = previousSupabaseUrl;
  }
});

test('retryableStages exposes all 5 pipeline stages in execution order', async () => {
  const { retryableStages } = await import('../src/core/retry-pipeline.js');
  assert.deepEqual(retryableStages(), ['distill', 'tag', 'dedup', 'enrich', 'render']);
});


