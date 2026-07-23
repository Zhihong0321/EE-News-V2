import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createCrawlJob,
  listCrawlJobs,
  summarizeCrawlJobs
} from '../src/core/factory-status.js';

function adapter() {
  return {
    id: 'example',
    source: 'Example News',
    country: 'MY',
    articleLimit: 3
  };
}

test('crawl status snapshots track worker progress and completion', async (t) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-status-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));

  const job = createCrawlJob(adapter(), { outputDirectory });
  await job.ready;
  await job.stage('discovering', 'Finding links');
  await job.setCandidates(4);
  await job.workerStarted('worker-1', { href: 'https://example.com/story', title: 'Story' });
  await job.workerPhase('worker-1', 'enriching');
  await job.workerFinished('worker-1', { ok: true });
  await job.complete({
    outputPath: path.join(outputDirectory, 'example-2026-07-22.json'),
    result: { count: 1, requested: 3, failures: [] }
  });

  const jobs = await listCrawlJobs({ outputDirectory });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'succeeded');
  assert.equal(jobs[0].progress.candidates, 4);
  assert.equal(jobs[0].progress.succeeded, 1);
  assert.equal(jobs[0].workers['worker-1'].state, 'complete');
  assert.deepEqual(summarizeCrawlJobs(jobs), {
    active: 0,
    completed: 1,
    failed: 0,
    articles: 1,
    processes: 0
  });
});

test('crawl status snapshots preserve failures without throwing', async (t) => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'factory-status-'));
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));

  const job = createCrawlJob(adapter(), { outputDirectory });
  await job.ready;
  const error = new Error('robots denied');
  error.code = 'ROBOTS_DISALLOWED';
  await job.fail(error);

  const [saved] = await listCrawlJobs({ outputDirectory });
  assert.equal(saved.status, 'failed');
  assert.equal(saved.error.message, 'robots denied');
  assert.equal(saved.error.code, 'ROBOTS_DISALLOWED');
});
