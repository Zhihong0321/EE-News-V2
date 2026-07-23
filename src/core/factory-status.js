import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const STATUS_DIRECTORY = '.factory';
const MAX_EVENTS = 40;
const STALE_AFTER_MS = 5 * 60 * 1000;
// Coalesce high-frequency worker events into at most one disk write per window.
// The UI polls slower than this, so debouncing kills disk churn with no visible
// lag. Terminal events (complete/fail) and the initial write flush immediately.
const WRITE_DEBOUNCE_MS = 500;

function nowIso() {
  return new Date().toISOString();
}

function statusRoot(outputDirectory) {
  return path.join(outputDirectory || path.resolve(process.cwd(), 'output'), STATUS_DIRECTORY);
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function publicError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || null
  };
}

export function createCrawlJob(adapter, { outputDirectory, target } = {}) {
  const startedAt = nowIso();
  const id = `${startedAt.replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const filePath = path.join(statusRoot(outputDirectory), `${id}.json`);
  const state = {
    id,
    pid: process.pid,
    site: adapter.id,
    source: adapter.source,
    country: adapter.country,
    status: 'running',
    stage: 'starting',
    message: 'Preparing crawl',
    startedAt,
    updatedAt: startedAt,
    finishedAt: null,
    outputPath: null,
    error: null,
    progress: {
      target: target === undefined ? adapter.articleLimit : target,
      candidates: 0,
      claimed: 0,
      completed: 0,
      succeeded: 0,
      failed: 0
    },
    workers: {},
    events: [{ at: startedAt, stage: 'starting', message: 'Preparing crawl' }]
  };
  let writeQueue = Promise.resolve();
  let debounceTimer = null;
  let dirty = false;
  let lastWriteAt = 0;

  function writeNow() {
    debounceTimer = null;
    dirty = false;
    lastWriteAt = Date.now();
    state.updatedAt = nowIso();
    const snapshot = structuredClone(state);
    writeQueue = writeQueue
      .catch(() => {})
      .then(() => writeAtomic(filePath, snapshot));
    return writeQueue.catch((error) => {
      console.warn(`Factory status update skipped for ${state.site}: ${error.message}`);
    });
  }

  // Debounced persist for frequent worker events: schedule a trailing write and
  // coalesce anything that arrives before the window elapses.
  function persist() {
    dirty = true;
    if (debounceTimer) return writeQueue.catch(() => {});
    const wait = Math.max(0, WRITE_DEBOUNCE_MS - (Date.now() - lastWriteAt));
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (dirty) writeNow();
    }, wait);
    if (debounceTimer.unref) debounceTimer.unref();
    return writeQueue.catch(() => {});
  }

  // Immediate flush for milestones we never want to lose or delay.
  function flush() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    return writeNow();
  }

  function addEvent(stage, message, details) {
    state.stage = stage;
    state.message = message;
    state.events.push({ at: nowIso(), stage, message, ...(details ? { details } : {}) });
    state.events = state.events.slice(-MAX_EVENTS);
  }

  const ready = flush();

  return {
    id,
    ready,
    async stage(stage, message, details) {
      addEvent(stage, message, details);
      await persist();
    },
    async setCandidates(count) {
      state.progress.candidates = count;
      addEvent('extracting', `Found ${count} candidate link${count === 1 ? '' : 's'}`);
      await persist();
    },
    async workerStarted(workerId, candidate) {
      state.progress.claimed += 1;
      state.workers[workerId] = {
        id: workerId,
        state: 'extracting',
        title: candidate.title || null,
        url: candidate.href,
        startedAt: nowIso()
      };
      state.stage = 'extracting';
      state.message = `Extracting ${state.progress.completed + 1} of ${state.progress.candidates}`;
      await persist();
    },
    async workerPhase(workerId, phase) {
      if (state.workers[workerId]) state.workers[workerId].state = phase;
      state.stage = phase;
      state.message = phase === 'enriching' ? 'Tagging and distilling article content' : state.message;
      await persist();
    },
    async workerFinished(workerId, { ok, reason } = {}) {
      const worker = state.workers[workerId];
      if (worker) {
        worker.state = ok ? 'complete' : 'failed';
        worker.finishedAt = nowIso();
        if (reason) worker.reason = reason;
      }
      state.progress.completed += 1;
      state.progress[ok ? 'succeeded' : 'failed'] += 1;
      state.message = `${state.progress.completed}/${state.progress.candidates} candidates processed`;
      await persist();
    },
    async complete(saved) {
      state.status = 'succeeded';
      state.stage = 'complete';
      state.finishedAt = nowIso();
      state.outputPath = saved.outputPath;
      state.result = {
        count: saved.result.count,
        requested: saved.result.requested,
        failures: saved.result.failures.length
      };
      addEvent('complete', `Saved ${saved.result.count} article${saved.result.count === 1 ? '' : 's'}`);
      await flush();
    },
    async fail(error) {
      state.status = 'failed';
      state.stage = 'failed';
      state.finishedAt = nowIso();
      state.error = publicError(error);
      addEvent('failed', state.error.message);
      await flush();
    }
  };
}

export async function listCrawlJobs({ outputDirectory, limit = 60 } = {}) {
  const directory = statusRoot(outputDirectory);
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const jobs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(directory, entry.name), 'utf8');
      const job = JSON.parse(raw);
      if (job.status === 'running' && Date.now() - Date.parse(job.updatedAt) > STALE_AFTER_MS) {
        job.status = 'stale';
        job.message = 'No heartbeat received from the crawler process';
      }
      jobs.push(job);
    } catch {
      // Ignore incomplete snapshots left by interrupted external processes.
    }
  }

  return jobs
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, Math.max(1, limit));
}

export function summarizeCrawlJobs(jobs) {
  const active = jobs.filter((job) => job.status === 'running');
  const completed = jobs.filter((job) => job.status === 'succeeded');
  const failed = jobs.filter((job) => job.status === 'failed' || job.status === 'stale');
  return {
    active: active.length,
    completed: completed.length,
    failed: failed.length,
    articles: completed.reduce((total, job) => total + (job.result?.count || 0), 0),
    processes: new Set(active.map((job) => job.pid)).size
  };
}
