import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listPublishedArticles } from '../src/server.js';

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rendered-path-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function enrichedArticle(n) {
  return {
    status: 'enriched',
    coreNews: {
      title: `Story ${n}`,
      url: `https://example.com/story-${n}`,
      body: 'A body with real text so the required-fields gate passes.',
      published_at: `2026-07-2${n}T00:00:00Z`,
      source: 'Example',
      country: 'MY',
      section: 'Energy',
      tags: ['solar', 'renewable-energy']
    },
    // Real enriched packets carry the transformed bilingual display content;
    // listPublishedArticles ships THIS (never the raw coreNews body/title).
    infographicContent: {
      coreNews: {
        displayTitle: { en: `Story ${n} — Analysis`, zh: `报道 ${n} — 分析` },
        summary: { en: `An enriched summary for story ${n}.`, zh: `报道 ${n} 的浓缩摘要。` },
        keyFacts: []
      }
    }
  };
}

async function writePacket(dir, base, articles) {
  const packetPath = path.join(dir, `infographic_${base}.json`);
  await fs.writeFile(packetPath, JSON.stringify({ source: 'Example', articles }), 'utf8');
  // Push the packet's mtime into the past so any render file written "now" is
  // unambiguously newer than it, regardless of filesystem mtime resolution.
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(packetPath, past, past);
  return packetPath;
}

async function writeRender(dir, name) {
  await fs.writeFile(path.join(dir, name), '<html><body>rendered</body></html>', 'utf8');
}

test('a single enriched article publishes with an UNsuffixed render file', async (t) => {
  const dir = await tempDir(t);
  const base = 'thestar-2026-07-22-abc';
  await writePacket(dir, base, [enrichedArticle(1)]);
  await writeRender(dir, `infographic_${base}.dc.html`);

  const result = await listPublishedArticles(dir);
  assert.equal(result.count, 1);
  assert.equal(result.articles[0].render_file, `infographic_${base}.dc.html`);
  assert.equal(result.articles[0].country, 'MY');
  assert.deepEqual(result.articles[0].tags, ['solar', 'renewable-energy']);
  assert.equal(result.skipped.total, 0);
});

test('multiple enriched articles require -N suffixed render files', async (t) => {
  const dir = await tempDir(t);
  const base = 'sinchew-2026-07-22-xyz';
  await writePacket(dir, base, [enrichedArticle(1), enrichedArticle(2)]);
  await writeRender(dir, `infographic_${base}-1.dc.html`);
  await writeRender(dir, `infographic_${base}-2.dc.html`);

  const result = await listPublishedArticles(dir);
  assert.equal(result.count, 2);
  const files = result.articles.map((a) => a.render_file).sort();
  assert.deepEqual(files, [`infographic_${base}-1.dc.html`, `infographic_${base}-2.dc.html`]);
});

test('a render older than its packet is hidden as stale and counted', async (t) => {
  const dir = await tempDir(t);
  const base = 'utusan-2026-07-22-old';
  // Write the render first, then a packet whose mtime is set to the FUTURE so
  // the render is older than the packet (the mtime gate should hide it).
  await writeRender(dir, `infographic_${base}.dc.html`);
  const packetPath = path.join(dir, `infographic_${base}.json`);
  await fs.writeFile(packetPath, JSON.stringify({ source: 'Example', articles: [enrichedArticle(1)] }), 'utf8');
  const future = new Date(Date.now() + 60_000);
  await fs.utimes(packetPath, future, future);

  const result = await listPublishedArticles(dir);
  assert.equal(result.count, 0);
  assert.equal(result.skipped.staleMtime, 1);
  assert.equal(result.skipped.total, 1);
});
