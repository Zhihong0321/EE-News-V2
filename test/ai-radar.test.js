import test from 'node:test';
import assert from 'node:assert/strict';

import { isRelevant, classifySignal, detectSubject, isTutorial } from '../ai-radar/src/relevance.js';
import { clusterItems } from '../ai-radar/src/cluster.js';
import { normalizeUrl } from '../ai-radar/src/http.js';
import { loadWatchlist, selectSources } from '../ai-radar/src/registry.js';

const aggregator = { group: 'aggregator', kind: 'rss', category: 'aggregator', entitySlug: 'hackernews' };
const vendorBlog = { group: 'entity', kind: 'rss', category: 'infra', entitySlug: 'nvidia' };
const firstParty = { group: 'entity', kind: 'hf_models', category: 'frontier', entitySlug: 'deepseek' };

test('relevance gate keeps AI stories from aggregator feeds', () => {
  assert.equal(isRelevant({ title: 'DeepSeek-V4-Flash is live on the API' }, aggregator), true);
  assert.equal(isRelevant({ title: 'Anthropic says Claude hacked three companies' }, aggregator), true);
});

test('relevance gate drops the off-topic stories aggregators actually carry', () => {
  // Every one of these appeared in a real run before the gate existed.
  assert.equal(isRelevant({ title: 'Saber-toothed cats became inbred before they went extinct' }, aggregator), false);
  assert.equal(isRelevant({ title: 'JEP 401: Value Objects (Preview) merged to OpenJDK master' }, aggregator), false);
  assert.equal(isRelevant({ title: 'SDL_GPU minimal single-header 2D graphics library' }, aggregator), false);
});

test('a vendor blog post about gaming is not AI news', () => {
  const item = { title: 'Best in Class: Stream PC Games and Study on the Same Laptop With GeForce NOW', summary: '' };
  assert.equal(isRelevant(item, vendorBlog), false);
});

test('first-party model uploads bypass the relevance gate', () => {
  assert.equal(isRelevant({ title: 'deepseek-ai/DeepSeek-V4' }, firstParty), true);
});

test('release classification needs model context, not just a release verb', () => {
  // Regression: "introduces" alone put an AWS monitoring post at the top of the
  // report as a model launch.
  const monitoring = { title: 'Inference meta-monitoring for Amazon SageMaker AI endpoints', summary: 'This post introduces model prediction quality tracking' };
  assert.notEqual(classifySignal(monitoring, vendorBlog), 'model_release');

  const release = { title: 'MiniMax releases H3 video model, open weights coming', summary: '' };
  assert.equal(classifySignal(release, aggregator), 'model_release');
});

test('documentation is classified as a guide, never a release', () => {
  const guide = { title: 'Deploying Kimi K3 on AWS', summary: 'Open weight models have become powerful' };
  assert.equal(isTutorial(guide), true);
  assert.equal(classifySignal(guide, vendorBlog), 'guide');
});

test('subject detection credits the lab, not the messenger', () => {
  const redditPost = { title: 'The official release Deepseek V4 flash is live on the API' };
  assert.deepEqual(detectSubject(redditPost), { slug: 'deepseek', tier: 1, name: 'DeepSeek' });
});

test('clustering merges one release reported under different headlines', () => {
  const items = [
    { title: 'DeepSeek-V4-Flash Update', url: 'https://a.test/1', score: 70, entityName: 'Hacker News', entityGroup: 'aggregator', subjectSlug: 'deepseek' },
    { title: 'DeepSeek-V4-Flash-0731 is going to cause another market crash', url: 'https://b.test/2', score: 60, entityName: 'r/LocalLLaMA', entityGroup: 'aggregator', subjectSlug: 'deepseek' },
    { title: 'The official release Deepseek V4 flash is live on the API', url: 'https://c.test/3', score: 65, entityName: 'r/LocalLLaMA', entityGroup: 'aggregator', subjectSlug: 'deepseek' }
  ];
  const clustered = clusterItems(items);
  assert.equal(clustered.length, 1, 'three reports of one release should be one story');
  assert.equal(clustered[0].clusterSize, 3);
  assert.equal(clustered[0].citations.length, 2);
});

test('clustering does not merge unrelated stories sharing a version number', () => {
  // Regression: matching on bare integers from "GPT-5.6" merged a Bedrock
  // pricing post with an OpenAI revenue report.
  const items = [
    { title: 'Introducing explicit prompt caching for OpenAI GPT-5.6 on Amazon Bedrock', url: 'https://a.test/1', score: 70, entityName: 'AWS AI', entityGroup: 'entity', subjectSlug: 'openai' },
    { title: 'OpenAI CFO Sarah Friar tells employees ARR in July topped all of Q2', url: 'https://b.test/2', score: 60, entityName: 'Hacker News', entityGroup: 'aggregator', subjectSlug: 'openai' }
  ];
  assert.equal(clusterItems(items).length, 2);
});

test('clustering prefers a first-party account as the story lead', () => {
  const items = [
    { title: 'Anthropic releases Claude Opus 5', url: 'https://hn.test/1', score: 90, entityName: 'Hacker News', entityGroup: 'aggregator', subjectSlug: 'anthropic' },
    { title: 'Anthropic releases Claude Opus 5 today', url: 'https://anthropic.test/2', score: 50, entityName: 'Anthropic', entityGroup: 'entity', subjectSlug: 'anthropic' }
  ];
  const [story] = clusterItems(items);
  assert.equal(story.entityName, 'Anthropic', 'the lab itself should lead over commentary');
});

test('url normalization strips tracking params and trailing slashes', () => {
  assert.equal(
    normalizeUrl('https://example.test/news/post/?utm_source=x&utm_medium=y#top'),
    'https://example.test/news/post'
  );
});

test('watchlist loads and only pollable sources are selected', async () => {
  const { sources } = await loadWatchlist();
  assert.ok(sources.length > 30, 'watchlist should carry the full channel set');

  const selected = selectSources(sources, { maxTier: 'cold' });
  assert.ok(selected.length > 0);
  // Sources marked broken/dropped/needs_adapter must never be polled.
  for (const source of selected) {
    assert.ok(['verified', 'mechanism_verified'].includes(source.status), `${source.id} should not be pollable`);
  }
});

test('tier selection is cumulative, not exact-match', () => {
  const sources = [
    { id: 'a', status: 'verified', kind: 'rss', pollTier: 'hot', entitySlug: 'x' },
    { id: 'b', status: 'verified', kind: 'rss', pollTier: 'cold', entitySlug: 'y' }
  ];
  assert.equal(selectSources(sources, { maxTier: 'hot' }).length, 1);
  assert.equal(selectSources(sources, { maxTier: 'cold' }).length, 2);
});

// --- video script ---------------------------------------------------------

import { selectBroadcastStories, buildVideoScript } from '../ai-radar/src/video.js';

const story = (over = {}) => ({
  title: 'MiniMax releases H3 video model',
  summary: 'Today we are launching MiniMax H3, a general-purpose multimodal generation model.',
  url: 'https://example.test/h3',
  score: 90,
  signalType: 'model_release',
  entityName: 'r/LocalLLaMA',
  entityGroup: 'aggregator',
  subjectSlug: 'minimax',
  ...over
});

test('broadcast gate drops guides and low-scoring items', () => {
  const items = [
    story(),
    story({ title: 'Deploying Kimi K3 on AWS', signalType: 'guide', url: 'https://e.test/g' }),
    story({ title: 'Anthropic ships Claude update', score: 20, url: 'https://e.test/l' })
  ];
  const picked = selectBroadcastStories(items);
  assert.equal(picked.length, 1);
  assert.match(picked[0].title, /MiniMax/);
});

test('broadcast gate requires a named actor', () => {
  // Regression: an anonymous Reddit project reached the bulletin and its VO
  // was a mid-thread VRAM caveat.
  const anonymous = story({
    title: 'Open Source Ternary LLM Engine in Rust/CUDA',
    subjectSlug: 'localllama',
    summary: 'There is a disclaimer, in that actual reductions in VRAM are less than 10x.'
  });
  assert.equal(selectBroadcastStories([anonymous]).length, 0);
});

test('one story per organization in the cut', () => {
  const items = [story({ url: 'https://e.test/1' }), story({ url: 'https://e.test/2' })];
  assert.equal(selectBroadcastStories(items).length, 1);
});

test('narration is attributed to the subject, not the outlet', () => {
  const script = buildVideoScript({ items: [story()], generatedAt: '2026-07-31T00:00:00.000Z' });
  const slide = script.segments.find((s) => s.type === 'story');
  assert.equal(slide.subhead, 'MiniMax');
  assert.equal(slide.via, 'r/LocalLLaMA', 'provenance is kept, not discarded');
});

test('narration rejects forum chatter and falls back to the full title', () => {
  const chatty = story({
    title: 'Zhipu releases GLM 5 with open weights',
    summary: "Hey guys, I'm a comp sci major and I built this cool project.",
    subjectSlug: 'zhipu'
  });
  const script = buildVideoScript({ items: [chatty], generatedAt: '2026-07-31T00:00:00.000Z' });
  const slide = script.segments.find((s) => s.type === 'story');
  assert.doesNotMatch(slide.narration, /comp sci major/);
  assert.match(slide.narration, /Zhipu releases GLM 5/);
});

test('narration never inherits the headline ellipsis', () => {
  const long = story({
    title: 'DeepSeek releases V4 Flash with major improvements to reasoning and coding across the board',
    summary: '',
    subjectSlug: 'deepseek'
  });
  const script = buildVideoScript({ items: [long], generatedAt: '2026-07-31T00:00:00.000Z' });
  const slide = script.segments.find((s) => s.type === 'story');
  assert.ok(slide.headline.length < long.title.length, 'headline is shortened');
  assert.doesNotMatch(slide.narration, /…/, 'VO must be speakable');
});

test('script reports a runtime and stays short', () => {
  const items = Array.from({ length: 20 }, (_, i) =>
    story({ url: `https://e.test/${i}`, subjectSlug: `org${i}`, title: `OpenAI ships model ${i}` }));
  const script = buildVideoScript({ items, generatedAt: '2026-07-31T00:00:00.000Z' });
  assert.ok(script.storyCount <= 6, 'bulletin is capped');
  assert.ok(script.totalDurationSec > 0 && script.totalDurationSec < 180);
});
