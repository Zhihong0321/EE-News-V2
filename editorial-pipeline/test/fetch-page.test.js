import test from 'node:test';
import assert from 'node:assert/strict';
import { createFetchPage } from '../src/fetch-page.js';

const adapter = {
  id: 'supported',
  source: 'Supported News',
  today: () => '2026-07-16'
};

test('fetch_page uses a matching custom adapter first', async () => {
  let fallbackCalls = 0;
  const fetchPage = createFetchPage({
    adapterFinder: async () => adapter,
    adapterFetcher: async () => ({
      transport: 'playwright',
      article: {
        url: 'https://supported.test/story',
        title: 'Supported story',
        body: 'A sufficiently useful fetched article body.',
        published_at: '2026-07-16T01:00:00.000Z',
        source: 'Supported News'
      }
    }),
    crawl4aiFetcher: async () => {
      fallbackCalls += 1;
      return {};
    }
  });
  const document = await fetchPage('https://supported.test/story');

  assert.equal(document.fetcherUsed, 'custom-site-crawler');
  assert.equal(document.adapterName, 'supported');
  assert.equal(document.failureReason, null);
  assert.equal(fallbackCalls, 0);
});

test('fetch_page records adapter fallback to Crawl4AI', async () => {
  const fetchPage = createFetchPage({
    adapterFinder: async () => adapter,
    adapterFetcher: async () => {
      throw new Error('selector no longer matched');
    },
    crawl4aiFetcher: async () => ({
      success: true,
      finalUrl: 'https://supported.test/story',
      statusCode: 200,
      title: 'Fallback story',
      markdown: 'Fallback article text.',
      metadata: {}
    })
  });
  const document = await fetchPage('https://supported.test/story');

  assert.equal(document.fetcherUsed, 'crawl4ai');
  assert.equal(document.fallback.from, 'custom-site-crawler');
  assert.match(document.fallback.reason, /selector/);
});

test('fetch_page never escalates a blocked adapter response', async () => {
  let fallbackCalls = 0;
  const fetchPage = createFetchPage({
    adapterFinder: async () => adapter,
    adapterFetcher: async () => {
      const error = new Error('HTTP 429');
      error.status = 429;
      throw error;
    },
    crawl4aiFetcher: async () => {
      fallbackCalls += 1;
      return {};
    }
  });
  const document = await fetchPage('https://supported.test/blocked');

  assert.equal(document.statusCode, 429);
  assert.equal(document.fetcherUsed, 'custom-site-crawler');
  assert.match(document.failureReason, /429/);
  assert.equal(fallbackCalls, 0);
});
