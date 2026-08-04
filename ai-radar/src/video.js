// Distills the daily report into a broadcast script.
//
// The daily report is a newsletter: ~80 stories, complete coverage, skim-first.
// A video is the opposite — linear, unskippable, and about 90 seconds long. The
// audience cannot scan past a weak item, so the only useful transformation is a
// hard cut to what is genuinely worth reporting out.
//
// Two jobs happen here:
//   1. Newsworthiness gate — far stricter than the report's relevance gate.
//   2. Reshaping — a short spoken line per story, with a word budget, because
//      narration is timed and a 40-word sentence is 16 seconds of screen time.
//
// Narration is built deterministically from the source text. It never invents a
// fact that is not in the title or summary: a news script that hallucinates is
// worse than no script.

import { detectSubject } from './relevance.js';

// Average narration pace. Used to turn word counts into runtime estimates.
const WORDS_PER_SECOND = 2.5;

// ~12s of speech. Long enough for a real sentence, short enough that no single
// slide dominates a 60-second bulletin.
const NARRATION_MAX_WORDS = 30;
const HEADLINE_MAX_WORDS = 9;

const DEFAULTS = {
  maxStories: 6,
  maxPerOrg: 1,
  minScore: 55
};

// Signals that carry a broadcast. Guides and undifferentiated "other" items are
// exactly the padding that makes a video feel long.
const BROADCAST_SIGNALS = new Set(['model_release', 'funding', 'policy', 'research', 'product']);

// Community projects and demos are interesting to a technical reader but they
// are not industry news; they get in only on an exceptional score.
const COMMUNITY = /^(show hn|launch hn|ask hn|\[p\]|\[d\])/i;

export function selectBroadcastStories(items, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const chosen = [];
  const perOrg = new Map();

  const eligible = items.filter((item) => {
    if (!BROADCAST_SIGNALS.has(item.signalType)) return false;
    if (COMMUNITY.test(item.title || '') && item.score < 90) return false;
    // A news bulletin needs a named actor. An anonymous community project has
    // no organization behind it, and its summary is forum discussion rather
    // than an announcement — one slide's VO was a mid-thread VRAM caveat.
    if (!detectSubject(item) && item.entityGroup !== 'entity') return false;
    return item.score >= config.minScore;
  });

  for (const item of eligible) {
    if (chosen.length >= config.maxStories) break;
    // One story per organization: three DeepSeek items in a six-item bulletin
    // reads as a DeepSeek ad, not a news round-up.
    const key = item.subjectSlug || item.entitySlug;
    const used = perOrg.get(key) || 0;
    if (used >= config.maxPerOrg) continue;
    chosen.push(item);
    perOrg.set(key, used + 1);
  }

  return chosen;
}

export function buildVideoScript({ items, generatedAt }, options = {}) {
  const date = generatedAt.slice(0, 10);
  const stories = selectBroadcastStories(items, options);
  const segments = stories.map((item, index) => toSegment(item, index + 1));

  const intro = {
    type: 'intro',
    slide: 0,
    headline: 'AI Daily',
    subhead: formatLongDate(date),
    narration: stories.length
      ? `Today in AI: ${topicTeaser(stories)}.`
      : 'No major AI stories to report today.',
    durationSec: 0
  };
  intro.durationSec = estimateSeconds(intro.narration) + 1.5; // + title card hold

  const outro = {
    type: 'outro',
    slide: segments.length + 1,
    headline: 'AI Daily',
    subhead: `${items.length} stories tracked · ${date}`,
    narration: 'That is today in AI.',
    durationSec: estimateSeconds('That is today in AI.') + 1.5
  };

  const all = [intro, ...segments, outro];
  const totalSec = Math.round(all.reduce((sum, segment) => sum + segment.durationSec, 0));

  return {
    date,
    generatedAt,
    totalDurationSec: totalSec,
    storyCount: segments.length,
    pooledFrom: items.length,
    segments: all
  };
}

function toSegment(item, slide) {
  const headline = toHeadline(item);
  const narration = toNarration(item);
  const org = displayOrg(item);
  return {
    type: 'story',
    slide,
    headline,
    // On screen, a MiniMax launch must read "MiniMax", not "r/LocalLLaMA".
    // The outlet that carried it is provenance, shown as an attribution line.
    subhead: org,
    via: org === item.entityName ? null : item.entityName,
    lowerThird: labelFor(item.signalType),
    narration,
    durationSec: estimateSeconds(narration) + 1, // + transition
    score: item.score,
    signalType: item.signalType,
    sourceUrl: item.url,
    // A story carried by several outlets earns an on-screen corroboration cue.
    sourceCount: (item.clusterSize || 1),
    citations: (item.citations || []).map((c) => c.url),
    visualHint: visualHintFor(item)
  };
}

// --- text shaping ---------------------------------------------------------

function toHeadline(item) {
  let text = clean(item.title || '');

  // Strip the noise real feeds carry: forum prefixes and wire-service credits.
  text = text
    .replace(/^(show hn|launch hn|ask hn|tell hn)\s*:\s*/i, '')
    .replace(/\s*\([^)]*\/[^)]*\)\s*$/, '')   // "(Eduardo Baptista/Reuters)"
    .replace(/^\s*[\w.-]+\s*\/\s*[\w\s]+:\s*/, '') // "Reuters: ..."
    .replace(/\s*[-–—|]\s*[^-–—|]{0,30}$/, (match) =>
      // Trailing " - Publication" is chrome; a real clause is not.
      /\b(reuters|bloomberg|cnbc|techcrunch|the verge|wired)\b/i.test(match) ? '' : match)
    .trim();

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > HEADLINE_MAX_WORDS) {
    // Prefer cutting at a clause boundary — "Minimax-H3 video model released,"
    // reads as a headline; "…open weights coming in the…" reads as a bug.
    const head = words.slice(0, HEADLINE_MAX_WORDS + 2);
    const breakAt = head.findIndex((word, index) => index >= 3 && /[,;:]$/.test(word));
    text = breakAt > -1
      ? head.slice(0, breakAt + 1).join(' ')
      : `${words.slice(0, HEADLINE_MAX_WORDS).join(' ')}…`;
  }
  return text.replace(/[.,;:…]+$/, (match) => (match.includes('…') ? '…' : ''));
}

// The full title, cleaned but never truncated. Narration must never inherit the
// headline's ellipsis — "Gemma 4 26B in 2 GB…." is not a sentence anyone can read
// aloud.
function fullTitleSentence(item) {
  const text = clean(item.title || '')
    .replace(/^(show hn|launch hn|ask hn|tell hn)\s*:\s*/i, '')
    .replace(/\s*\([^)]*\/[^)]*\)\s*$/, '')
    .trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function toNarration(item) {
  const sentences = usableSummarySentences(item).filter(isInformative);
  const lead = sentences[0];

  // Prefer the source's own first sentence when it reads as prose and actually
  // says something. Otherwise the full title is the most factual line available.
  let narration = lead && wordCount(lead) >= 8 ? lead : fullTitleSentence(item);

  // Add a second sentence only if there is room in the budget.
  const second = sentences[1];
  if (second && wordCount(narration) + wordCount(second) <= NARRATION_MAX_WORDS) {
    narration = `${narration} ${second}`;
  }

  return trimToWords(narration, NARRATION_MAX_WORDS);
}

// Filters out the boilerplate that aggregator summaries are made of — Reddit
// submission footers, Hacker News point tallies, bare URLs — none of which can
// be spoken aloud.
function usableSummarySentences(item) {
  const raw = clean(item.summary || '');
  if (!raw) return [];

  const cleaned = raw
    .replace(/https?:\/\/\S+/g, '')
    .replace(/submitted by\s*\/u\/\S+/gi, '')
    .replace(/\[link\]|\[comments\]/gi, '')
    .replace(/^\d+\s*points?\s*·.*$/i, '')
    .replace(/\d+\s*points?\s*·\s*\d+\s*comments? on hacker news/i, '')
    .replace(/this post is co-written with[^.]*\./i, '')
    // Lead-ins that betray the source medium. "Quote from their article: Today
    // we're launching…" is not something a narrator says.
    // ^\s* matters: stripping a leading URL leaves whitespace, which made the
    // anchor fail and shipped "Quote from their article:" into the VO.
    .replace(/^\s*(quote from (their|the) article|from the (article|blog|post)|according to the post)\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    // " on Amazon Bedrock ." -> " on Amazon Bedrock."
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();

  if (!cleaned) return [];

  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => wordCount(sentence) >= 5 && !/^[^a-z]*$/i.test(sentence))
    .map((sentence) => (/[.!?]$/.test(sentence) ? sentence : `${sentence}.`));
}

// A sentence earns airtime only if it carries a fact: a named organization or
// model, or a number. Without this the script picked forum chatter — one slide's
// entire VO was "This post was not written by a clanker."
const NAMED_THING = /(openai|anthropic|claude|gpt|gemini|gemma|deepseek|qwen|kimi|moonshot|zhipu|glm|minimax|llama|mistral|nvidia|grok|bytedance|model|weights|benchmark|api|parameters?)/i;
const CHATTER = /^(this post|edit:|update:|i |we all |my |imo\b|tl;dr|thanks|note:|disclaimer|hey|hi |hello|so i\b|just wanted|first post)/i;
// First-person authorship reads as a forum post, not a news item. "Hey guys,
// I'm a comp sci major who wanted to introduce a cool project I built" was
// 14 seconds of a 59-second bulletin.
const SELF_PROMO = /\b(i'm|i am|i've|i built|i made|i wanted|my project|a cool project)\b/i;

function isInformative(sentence) {
  if (CHATTER.test(sentence) || SELF_PROMO.test(sentence)) return false;
  return NAMED_THING.test(sentence) || /\d/.test(sentence);
}

function visualHintFor(item) {
  if (item.signalType === 'model_release') return 'model-card';
  if (item.signalType === 'funding') return 'figure-callout';
  if (item.signalType === 'policy') return 'document';
  if (item.signalType === 'research') return 'chart';
  return 'headline-card';
}

// Teasing "r/LocalLLaMA, Hacker News, AWS AI" names the messengers. The
// audience wants the companies the news is about.
function topicTeaser(stories) {
  const orgs = [...new Set(stories.map((s) => displayOrg(s)))].slice(0, 3);
  if (orgs.length <= 1) return orgs[0] || 'the latest';
  return `${orgs.slice(0, -1).join(', ')} and ${orgs[orgs.length - 1]}`;
}

// A community project that merely uses Gemma is not a Google story, so the
// publisher stays the attribution in that case.
function displayOrg(item) {
  if (COMMUNITY.test(item.title || '')) return item.entityName;
  return detectSubject(item)?.name || item.entityName;
}

// --- helpers --------------------------------------------------------------

function clean(value) {
  return decodeEntities(String(value))
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function wordCount(text) {
  return String(text).split(/\s+/).filter(Boolean).length;
}

function trimToWords(text, max) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  const trimmed = words.slice(0, max).join(' ').replace(/[,;:]$/, '');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function estimateSeconds(text) {
  return Math.round((wordCount(text) / WORDS_PER_SECOND) * 10) / 10;
}

function labelFor(signalType) {
  return {
    model_release: 'MODEL RELEASE',
    funding: 'FUNDING',
    policy: 'POLICY',
    research: 'RESEARCH',
    product: 'PRODUCT'
  }[signalType] || 'NEWS';
}

function formatLongDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}

// --- rendering ------------------------------------------------------------

export function renderVideoScript(script) {
  const lines = [];

  lines.push('---');
  lines.push(`title: "AI Daily — Video Script — ${script.date}"`);
  lines.push(`date: ${script.date}`);
  lines.push(`generated_at: ${script.generatedAt}`);
  lines.push(`runtime_seconds: ${script.totalDurationSec}`);
  lines.push(`slide_count: ${script.segments.length}`);
  lines.push(`story_count: ${script.storyCount}`);
  lines.push(`distilled_from: ${script.pooledFrom}`);
  lines.push('---');
  lines.push('');
  lines.push(`# AI Daily — Video Script`);
  lines.push('');
  lines.push(`**${formatLongDate(script.date)}** · ${script.storyCount} stories · ~${script.totalDurationSec}s runtime · distilled from ${script.pooledFrom}`);
  lines.push('');

  if (!script.storyCount) {
    lines.push('> Nothing cleared the newsworthiness bar today. No video.');
    lines.push('');
    return lines.join('\n');
  }

  for (const segment of script.segments) {
    lines.push('---');
    lines.push('');
    const label = segment.type === 'story'
      ? `## Slide ${segment.slide} · ${segment.lowerThird}`
      : `## ${segment.type === 'intro' ? 'Open' : 'Close'}`;
    lines.push(label);
    lines.push('');
    lines.push(`**${segment.headline}**`);
    if (segment.subhead) lines.push(`_${segment.subhead}_`);
    lines.push('');
    lines.push('**VO:**');
    lines.push(`> ${segment.narration}`);
    lines.push('');

    const meta = [`⏱ ${segment.durationSec}s`];
    if (segment.visualHint) meta.push(`🎬 ${segment.visualHint}`);
    if (segment.sourceCount > 1) meta.push(`📡 ${segment.sourceCount} sources`);
    if (segment.score) meta.push(`score ${segment.score}`);
    lines.push(meta.join(' · '));
    if (segment.sourceUrl) {
      lines.push('');
      lines.push(`[Source](${segment.sourceUrl})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
