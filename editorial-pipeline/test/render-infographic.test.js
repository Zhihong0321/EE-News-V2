import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderInfographicDocument } from '../templates/infographic/render.js';
import { renderInfographicPacket, infographicHtmlOutputName } from '../src/render-infographic.js';

function bi(en, zh) {
  return { en, zh };
}

function fixtureEntry(overrides = {}) {
  return {
    status: 'enriched',
    coreNews: {
      source: 'Example News',
      country: 'MY',
      title: 'Example <script>alert(1)</script> title',
      url: 'https://example.test/news',
      published_at: '2026-07-16T08:00:00.000Z'
    },
    infographicContent: {
      coreNews: {
        originalTitle: 'Example <script>alert(1)</script> title',
        displayTitle: bi('A "Tricky" Title & Test', '一个"棘手"的标题'),
        publisher: 'Example News',
        publishedAt: '2026-07-16T08:00:00.000Z',
        sourceUrl: 'https://example.test/news',
        summary: bi('A concise summary with <b>markup</b>.', '一个简明的摘要。'),
        keyFacts: [
          { text: bi('100 MW was awarded.', '授予了100兆瓦。'), sourceId: 'core' },
          { text: bi('The gap was 20 MW.', '差距为20兆瓦。'), sourceId: 'core' }
        ]
      },
      centralInsight: bi('Awards fell short of submissions.', '授予量低于提交量。'),
      dimensions: [
        {
          title: bi('Capacity Awarded', '授予容量'),
          relationship: 'comparison',
          insight: bi('Awarded capacity trailed submitted bids.', '授予容量落后于提交的投标。'),
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
          suggestedPresentation: 'number'
        },
        {
          title: bi('Regional Comparison', '区域对比'),
          relationship: 'consequence',
          insight: bi('Neighboring markets awarded more.', '周边市场授予了更多容量。'),
          supportingFacts: [],
          metrics: [
            { label: bi('Market A', 'A市场'), value: 100, unit: bi('MW', '兆瓦'), period: bi('2026', '2026年'), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' },
            { label: bi('Market B', 'B市场'), value: 250, unit: bi('MW', '兆瓦'), period: bi('2026', '2026年'), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' }
          ],
          suggestedPresentation: 'comparison'
        },
        {
          title: bi('Price Trend', '价格走势'),
          relationship: 'future-signal',
          insight: bi('Prices climbed steadily.', '价格稳步上涨。'),
          supportingFacts: [],
          metrics: [
            { label: bi('Q1', 'Q1'), value: 10, unit: bi('USD', '美元'), period: bi('Q1 2026', '2026年Q1'), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' },
            { label: bi('Q2', 'Q2'), value: 18, unit: bi('USD', '美元'), period: bi('Q2 2026', '2026年Q2'), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' }
          ],
          suggestedPresentation: 'chart'
        },
        {
          title: bi('Project History', '项目历史'),
          relationship: 'historical-context',
          insight: bi('The project took years to approve.', '该项目历经多年才获批。'),
          supportingFacts: [{ text: bi('Approved in 2024.', '2024年获批。'), sourceId: 'core', confidence: 'high' }],
          metrics: [
            { label: bi('Milestone', '里程碑'), value: 1, unit: bi('', ''), period: bi('2024-01-01', '2024年1月1日'), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' }
          ],
          suggestedPresentation: 'timeline'
        },
        {
          title: bi('Local Impact', '本地影响'),
          relationship: 'stakeholder-impact',
          insight: bi('Nearby communities gain jobs.', '周边社区获得就业机会。'),
          supportingFacts: [{ text: bi('Jobs estimated at 500.', '预计提供500个岗位。'), sourceId: 'core', confidence: 'medium' }],
          metrics: [
            { label: bi('Estimated jobs', '预计岗位'), value: 500, unit: bi('workers', '人'), period: bi('', ''), comparisonValue: null, comparisonPeriod: bi('', ''), sourceId: 'core' }
          ],
          suggestedPresentation: 'map'
        },
        {
          title: bi('Official Statement', '官方声明'),
          relationship: 'cause',
          insight: bi('The minister explained the rationale.', '部长解释了理由。'),
          supportingFacts: [
            { text: bi('"We need more capacity," the minister said.', '"我们需要更多产能，"部长表示。'), sourceId: 'core', confidence: 'high' },
            { text: bi('The statement followed a review.', '该声明是在审查之后发表的。'), sourceId: 'core', confidence: 'medium' }
          ],
          metrics: [],
          suggestedPresentation: 'quote'
        },
        {
          title: bi('Policy Priorities', '政策重点'),
          relationship: 'contradiction',
          insight: bi('Targets conflict with the current budget.', '目标与当前预算存在冲突。'),
          supportingFacts: [{ text: bi('Budget shortfall estimated.', '预计存在预算缺口。'), sourceId: 'core', confidence: 'low' }],
          metrics: [],
          suggestedPresentation: 'text'
        }
      ],
      timeline: [
        { date: '2026-01-01', event: bi('Review started.', '审查启动。'), sourceId: 'core' },
        { date: '2026-07-16', event: bi('Awards announced.', '奖励公布。'), sourceId: 'core' }
      ],
      keyTakeaway: bi('The award did not use all submitted capacity.', '此次授予并未用尽全部提交容量。'),
      whatToWatch: [bi('Final contracts.', '最终合同。'), bi('Grid connection dates.', '并网日期。')],
      uncertainties: [bi('Pricing not finalized.', '定价尚未最终确定。')],
      sources: [
        { id: 'core', title: bi('Example core news', '示例核心新闻'), publisher: 'Example News', publishedAt: '2026-07-16T08:00:00.000Z', url: 'https://example.test/news' },
        { id: 'ext1', title: bi('External <angle> source', '外部来源'), publisher: 'Regulator & Co', publishedAt: '2026-06-01', url: 'https://example.test/ext?a=1&b=2' }
      ]
    },
    validation: { valid: true, errors: [], warnings: [] }
  };
}

test('renders every suggestedPresentation type without throwing', () => {
  const html = renderInfographicDocument(fixtureEntry());
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /<x-dc>/);
  assert.match(html, /class Component extends DCLogic/);
  // one card per dimension
  assert.equal((html.match(/data-reveal style="background:var\(--card\)/g) || []).length, 7);
});

test('escapes user-controlled text so it cannot break out of markup', () => {
  const html = renderInfographicDocument(fixtureEntry());
  assert.doesNotMatch(html, /<b>markup<\/b>/);
  assert.match(html, /&lt;b&gt;markup&lt;\/b&gt;/);
  assert.match(html, /External &lt;angle&gt; source/);
  assert.match(html, /href="https:\/\/example\.test\/ext\?a=1&amp;b=2"/);
  assert.match(html, /A &quot;Tricky&quot; Title &amp; Test/);
});

test('omits the hero stat strip and dimensions section when there is no data', () => {
  const entry = fixtureEntry();
  entry.infographicContent.dimensions = [];
  const html = renderInfographicDocument(entry);
  assert.doesNotMatch(html, /data-screen-label="Dimensions"/);
  assert.doesNotMatch(html, /grid-template-columns:repeat\(/);
});

test('comparison and chart dimensions render normalized bars', () => {
  const html = renderInfographicDocument(fixtureEntry());
  // Market B (250) should reach a full-width bar, Market A (100) a partial one.
  assert.match(html, /width:100%"><\/i>/);
  assert.match(html, /width:40%"><\/i>/);
});

test('renderInfographicPacket writes support.js once and one .dc.html per enriched article', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'infographic-render-'));
  const packetPath = path.join(directory, 'infographic_example-2026-07-16.json');
  const second = fixtureEntry();
  second.coreNews.url = 'https://example.test/news-2';
  second.infographicContent.coreNews.sourceUrl = 'https://example.test/news-2';
  await fs.writeFile(packetPath, JSON.stringify({
    schemaVersion: 1,
    articles: [fixtureEntry(), second, { status: 'failed', coreNews: { title: 'skip me' } }]
  }), 'utf8');

  const { supportJsPath, rendered } = await renderInfographicPacket(packetPath);

  assert.equal(rendered.length, 2);
  assert.equal(path.basename(rendered[0].outputPath), infographicHtmlOutputName(packetPath, 0, 2));
  assert.equal(path.basename(rendered[1].outputPath), infographicHtmlOutputName(packetPath, 1, 2));
  assert.ok(rendered[0].outputPath.endsWith('-1.dc.html'));
  assert.ok(rendered[1].outputPath.endsWith('-2.dc.html'));

  const supportJs = await fs.readFile(supportJsPath, 'utf8');
  assert.match(supportJs, /dc-runtime/);
  for (const { outputPath } of rendered) {
    const html = await fs.readFile(outputPath, 'utf8');
    assert.match(html, /<script src="\.\/support\.js">/);
  }
});
