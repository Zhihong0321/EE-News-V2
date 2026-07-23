import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResearchSession } from '../src/research-session.js';
import { replayResearchPacket } from '../src/packet-store.js';
import { sha256 } from '../src/utils.js';

test('research sessions preserve events, evidence, and deterministic replay', async () => {
  const body = 'First verified paragraph.\n\nSecond verified paragraph.';
  const searchWeb = async (query) => ({
    query,
    provider: 'fixture',
    searchedAt: '2026-07-16T00:00:00.000Z',
    results: [{ title: 'Story', url: 'https://example.test/story', query, discoveryOnly: true }]
  });
  const fetchPage = async (url) => ({
    id: sha256(url),
    requestedUrl: url,
    finalUrl: url,
    statusCode: 200,
    title: 'Story',
    publishedAt: '2026-07-16T00:00:00.000Z',
    author: 'Reporter',
    publisher: 'Example',
    cleanedText: body,
    excerpts: ['First verified paragraph.'],
    extractionQuality: { score: 0.8, signals: {} },
    failureReason: null,
    rawSourceMetadata: {},
    fetcherUsed: 'crawl4ai',
    adapterName: null,
    fallback: null,
    retrievedAt: '2026-07-16T00:01:00.000Z',
    contentHash: sha256(body)
  });
  const session = new ResearchSession({ question: 'What happened?', searchWeb, fetchPage });

  await session.search('example query');
  const document = await session.fetch('https://example.test/story');
  const evidence = session.addEvidence({
    documentId: document.id,
    statement: 'The first paragraph was verified.',
    excerpt: 'First verified paragraph.',
    confidence: 'high'
  });
  assert.equal(evidence.sourceUrl, document.finalUrl);
  assert.throws(() => session.addEvidence({
    documentId: document.id,
    statement: 'Unsupported',
    excerpt: 'This text does not exist.'
  }), /not found/);

  session.complete();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'research-packet-'));
  const outputPath = await session.save(directory);
  const replay = await replayResearchPacket(outputPath);

  assert.equal(replay.valid, true);
  assert.equal(replay.replayedWithoutNetwork, true);
  assert.equal(replay.packet.events.at(-1).type, 'complete');
});
