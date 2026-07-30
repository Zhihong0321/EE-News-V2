import test from 'node:test';
import assert from 'node:assert/strict';

// Must be set before server.js is imported — it reads HUB_API_KEY once at
// module load, same as FACTORY_PASSWORD.
process.env.HUB_API_KEY = 'test-hub-key';

const { server } = await import('../src/server.js');

async function withListeningServer(fn) {
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('hub routes reject requests without a valid key', async () => {
  await withListeningServer(async (base) => {
    const noKey = await fetch(`${base}/api/hub/existing-urls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: [] })
    });
    assert.equal(noKey.status, 401);

    const wrongKey = await fetch(`${base}/api/hub/existing-urls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-key': 'nope' },
      body: JSON.stringify({ urls: [] })
    });
    assert.equal(wrongKey.status, 401);
  });
});

test('existing-urls returns an empty list when the hub has no database configured', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/hub/existing-urls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-key': 'test-hub-key' },
      body: JSON.stringify({ urls: ['https://a', 'https://b'] })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, existing: [] });
  });
});

test('persist-articles no-ops without a database and returns an empty id list', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/hub/persist-articles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-key': 'test-hub-key' },
      body: JSON.stringify({ articles: [{ title: 't', url: 'https://a' }] })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, ids: [] });
  });
});

test('stage-status accepts the request and no-ops without a database', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/hub/stage-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-key': 'test-hub-key' },
      body: JSON.stringify({ articleId: 1, stage: 'distill', status: 'pending' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test('debug/status reports db as unconfigured when there is no DATABASE_URL', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/hub/debug/status`, {
      headers: { 'x-hub-key': 'test-hub-key' }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.db, { configured: false, connected: false, error: null, host: null, private: null });
    assert.deepEqual(body.pipeline, { counts: [] });
    assert.equal(typeof body.process.uptimeSeconds, 'number');
  });
});

test('debug/status requires a valid hub key', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/hub/debug/status`);
    assert.equal(response.status, 401);
  });
});

test('the factory routes are unaffected by the hub key gate', async () => {
  await withListeningServer(async (base) => {
    const response = await fetch(`${base}/api/factory/session`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
  });
});
