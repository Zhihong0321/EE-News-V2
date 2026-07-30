import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDbEnabled,
  getExistingArticleUrls,
  persistArticles,
  recordStageStatus
} from '../src/db/hub-client.js';

function withHubEnv(url, key, fn) {
  const previousUrl = process.env.HUB_URL;
  const previousKey = process.env.HUB_API_KEY;
  if (url === undefined) delete process.env.HUB_URL; else process.env.HUB_URL = url;
  if (key === undefined) delete process.env.HUB_API_KEY; else process.env.HUB_API_KEY = key;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousUrl === undefined) delete process.env.HUB_URL; else process.env.HUB_URL = previousUrl;
      if (previousKey === undefined) delete process.env.HUB_API_KEY; else process.env.HUB_API_KEY = previousKey;
    });
}

function withFetch(handler, fn) {
  const previousFetch = global.fetch;
  global.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => { global.fetch = previousFetch; });
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('isDbEnabled is false without both HUB_URL and HUB_API_KEY', async () => {
  await withHubEnv(undefined, undefined, () => {
    assert.equal(isDbEnabled(), false);
  });
  await withHubEnv('https://hub.example', undefined, () => {
    assert.equal(isDbEnabled(), false);
  });
  await withHubEnv(undefined, 'secret', () => {
    assert.equal(isDbEnabled(), false);
  });
  await withHubEnv('https://hub.example', 'secret', () => {
    assert.equal(isDbEnabled(), true);
  });
});

test('reads no-op (no fetch call) when the hub is not configured', async () => {
  await withHubEnv(undefined, undefined, async () => {
    let called = false;
    await withFetch(() => { called = true; }, async () => {
      const existing = await getExistingArticleUrls(['https://a']);
      assert.deepEqual([...existing], []);
      const ids = await persistArticles([{ title: 't', url: 'https://a' }]);
      assert.equal(ids.size, 0);
      await recordStageStatus(1, 'distill', 'pending');
    });
    assert.equal(called, false);
  });
});

test('getExistingArticleUrls posts urls and returns a Set from the response', async () => {
  await withHubEnv('https://hub.example', 'secret', async () => {
    let capturedUrl, capturedInit;
    await withFetch(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return jsonResponse(200, { ok: true, existing: ['https://a'] });
    }, async () => {
      const result = await getExistingArticleUrls(['https://a', 'https://b']);
      assert.deepEqual([...result], ['https://a']);
    });
    assert.equal(capturedUrl, 'https://hub.example/api/hub/existing-urls');
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['x-hub-key'], 'secret');
    assert.deepEqual(JSON.parse(capturedInit.body), { urls: ['https://a', 'https://b'] });
  });
});

test('persistArticles converts the [url, id] pairs into a Map', async () => {
  await withHubEnv('https://hub.example', 'secret', async () => {
    await withFetch(async () => jsonResponse(200, { ok: true, ids: [['https://a', 42]] }), async () => {
      const ids = await persistArticles([{ title: 't', url: 'https://a' }]);
      assert.equal(ids.get('https://a'), 42);
    });
  });
});

test('recordStageStatus sends the stage payload', async () => {
  await withHubEnv('https://hub.example', 'secret', async () => {
    let capturedBody;
    await withFetch(async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return jsonResponse(200, { ok: true });
    }, async () => {
      await recordStageStatus(7, 'tag', 'failed', new Error('boom'));
    });
    assert.deepEqual(capturedBody, { articleId: 7, stage: 'tag', status: 'failed', error: 'Error: boom' });
  });
});

test('a non-ok response throws an error carrying the HTTP status', async () => {
  await withHubEnv('https://hub.example', 'secret', async () => {
    await withFetch(async () => jsonResponse(401, { ok: false, error: 'Hub authentication required' }), async () => {
      await assert.rejects(
        () => getExistingArticleUrls(['https://a']),
        (error) => {
          assert.equal(error.status, 401);
          assert.match(error.message, /Hub authentication required/);
          return true;
        }
      );
    });
  });
});

test('a network failure throws an error with no HTTP status (so runner.js retries it)', async () => {
  await withHubEnv('https://hub.example', 'secret', async () => {
    await withFetch(async () => { throw new Error('fetch failed'); }, async () => {
      await assert.rejects(
        () => getExistingArticleUrls(['https://a']),
        (error) => {
          assert.equal(error.status, undefined);
          return true;
        }
      );
    });
  });
});
