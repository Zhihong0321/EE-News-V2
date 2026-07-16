import test from 'node:test';
import assert from 'node:assert/strict';
import { extractArticle } from '../src/core/readability.js';

test('generic extraction reads article metadata and body', () => {
  const html = `<!doctype html><html><head>
    <meta property="article:published_time" content="2026-07-16T10:00:00+08:00">
    <script type="application/ld+json">{"@type":"NewsArticle","headline":"Test headline","author":{"name":"Test author"}}</script>
  </head><body><main><article><h1>Test headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></main></body></html>`;
  const result = extractArticle(html, 'https://example.test/article');
  assert.equal(result.title, 'Test headline');
  assert.equal(result.author, 'Test author');
  assert.equal(result.datePublished, '2026-07-16T10:00:00+08:00');
  assert.match(result.body, /First paragraph/);
  assert.match(result.body, /Second paragraph/);
});
