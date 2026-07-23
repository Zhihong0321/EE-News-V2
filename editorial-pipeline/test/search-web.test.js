import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchWeb } from '../src/search-web.js';

test('search_web normalizes results and removes duplicate URLs', async () => {
  const provider = {
    id: 'test',
    async search() {
      return [
        { title: 'One', url: 'https://example.test/story?utm_source=x', snippet: ' first ' },
        { title: 'Duplicate', url: 'https://example.test/story', snippet: 'second' },
        { title: 'Two', url: 'https://news.test/two', publisher: 'News Test' }
      ];
    }
  };
  const searchWeb = createSearchWeb({ providers: { test: provider } });
  const result = await searchWeb('  research   question  ');

  assert.equal(result.query, 'research question');
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].url, 'https://example.test/story');
  assert.equal(result.results[0].query, 'research question');
  assert.equal(result.results[0].discoveryOnly, true);
  assert.equal(result.results[1].publisher, 'News Test');
});
