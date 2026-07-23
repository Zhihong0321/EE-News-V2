import test from 'node:test';
import assert from 'node:assert/strict';
import { listAdapters } from '../src/sites/index.js';

test('every registered site has the adapter contract', () => {
  const adapters = listAdapters();
  assert.equal(new Set(adapters.map((adapter) => adapter.id)).size, adapters.length);
  assert.ok(adapters.length >= 1);
  for (const adapter of adapters) {
    assert.match(adapter.country, /^[A-Z]{2}$/);
    assert.match(adapter.latestUrl, /^https:\/\//);
    assert.equal(typeof adapter.today, 'function');
    assert.equal(typeof adapter.collectLinks, 'function');
    assert.equal(typeof adapter.readArticle, 'function');
  }
});
