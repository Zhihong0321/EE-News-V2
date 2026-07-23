import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildEnrichmentPrompt } from '../src/enrichment-prompt.js';
import { enrichNewsFile, infographicOutputName } from '../src/enrich-news.js';
import { validateEnrichment } from '../src/enrichment-validator.js';

const article = {
  source: 'Example News',
  title: 'Example core news',
  url: 'https://example.test/news',
  published_at: '2026-07-16T08:00:00.000Z',
  author: 'Reporter',
  section: 'News',
  body: 'The core article reports 100 MW awarded from 120 MW of bids.'
};

function bi(en, zh = '测试') {
  return { en, zh };
}

function validContent() {
  return {
    coreNews: {
      originalTitle: article.title,
      displayTitle: bi('Example display title', '示例显示标题'),
      publisher: article.source,
      publishedAt: article.published_at,
      sourceUrl: article.url,
      summary: bi('A concise summary.', '简明摘要。'),
      keyFacts: [{ text: bi('100 MW was awarded.', '授予了100兆瓦。'), sourceId: 'core' }]
    },
    centralInsight: bi('Participation exceeded awards.', '参与超过了授予。'),
    dimensions: [{
      title: bi('Comparison', '对比'),
      relationship: 'comparison',
      insight: bi('Awards were lower than submitted bids.', '授予低于提交的投标。'),
      supportingFacts: [{ text: bi('The gap was 20 MW.', '差距为20兆瓦。'), sourceId: 'core', confidence: 'high' }],
      metrics: [{
        label: bi('Awarded capacity', '授予容量'),
        value: 100,
        unit: bi('MW', '兆瓦'),
        period: bi('July 2026', '2026年7月'),
        comparisonValue: 120,
        comparisonPeriod: bi('Submitted capacity', '提交容量'),
        sourceId: 'core'
      }],
      suggestedPresentation: 'comparison'
    }],
    timeline: [{ date: '2026-07-16', event: bi('Awards announced.', '宣布授予。'), sourceId: 'core' }],
    keyTakeaway: bi('The award did not use all submitted capacity.', '授予未利用全部提交容量。'),
    whatToWatch: [],
    uncertainties: [],
    sources: [{
      id: 'core',
      title: bi(article.title, '示例核心新闻'),
      publisher: article.source,
      publishedAt: article.published_at,
      url: article.url
    }]
  };
}

test('enrichment prompt preserves the core article and cutoff', () => {
  const prompt = buildEnrichmentPrompt(article);
  assert.match(prompt, /Example core news/);
  assert.match(prompt, /https:\/\/example\.test\/news/);
  assert.match(prompt, /Treat 2026-07-16 as the research cutoff/);
  assert.match(prompt, /Do not create HTML/);
});

test('enrichment validation rejects unknown sources and post-cutoff material', () => {
  const content = validContent();
  content.dimensions[0].supportingFacts[0].sourceId = 'missing';
  content.sources.push({
    id: 'future',
    title: 'Future report',
    publisher: 'Example',
    publishedAt: '2026-07-17',
    url: 'https://example.test/future'
  });
  const validation = validateEnrichment(article, content);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('Unknown source reference')));
  assert.ok(validation.errors.some((error) => error.includes('newer than')));
});

test('news enrichment writes an infographic_ packet and supports reruns', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'infographic-enrichment-'));
  const inputPath = path.join(directory, 'example-2026-07-16.json');
  await fs.writeFile(inputPath, JSON.stringify({
    source: article.source,
    fetched_at: '2026-07-16T09:00:00.000Z',
    articles: [article]
  }), 'utf8');
  const provider = {
    id: 'fixture-terra',
    async enrich() {
      return {
        content: validContent(),
        provenance: { model: 'fixture-terra', webSearchCalls: 2, apiCitations: [] }
      };
    }
  };

  const first = await enrichNewsFile(inputPath, { provider, outputDirectory: directory });
  const second = await enrichNewsFile(inputPath, { provider, outputDirectory: directory });
  assert.equal(path.basename(first.outputPath), 'infographic_example-2026-07-16.json');
  assert.equal(infographicOutputName(inputPath), 'infographic_example-2026-07-16.json');
  assert.equal(second.outputPath, first.outputPath);
  assert.equal(second.packet.count, 1);
  assert.equal(second.packet.articles[0].status, 'enriched');
  assert.equal(second.packet.articles[0].coreNews.title, article.title);
});
