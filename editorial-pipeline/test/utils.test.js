import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanCorruptedText, isCorruptedContent, needsContentRefill } from '../src/utils.js';

test('replacement characters remain marked for AGY refill', () => {
  const packet = { title: '人工智能技术\uFFFD\uFFFD刷马', summary: '正常文字' };

  const cleaned = cleanCorruptedText(packet);

  assert.equal(cleaned.title, packet.title);
  assert.equal(needsContentRefill(cleaned), true);
  assert.equal(isCorruptedContent(cleaned), true);
});

test('reversible escaped numeric entities are cleaned locally', () => {
  const cleaned = cleanCorruptedText({ title: '&amp;#20154;&amp;#24037;智能' });

  assert.equal(cleaned.title, '人工智能');
  assert.equal(needsContentRefill(cleaned), false);
  assert.equal(isCorruptedContent(cleaned), false);
});
