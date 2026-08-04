// Event clustering: many items, one real-world event.
//
// A single announcement arrives as several rows — Hacker News, TechCrunch,
// Techmeme and Reddit all cover "Anthropic says Claude hacked three companies"
// under different URLs and slightly different headlines. Reporting them as four
// stories buries everything else.
//
// v1 uses title-token Jaccard similarity rather than embeddings: it is
// deterministic, needs no model call, and is easy to reason about when it
// misfires. The LLM clustering described in PLAN.md §8 can replace this later
// without changing the interface.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it',
  'its', 'that', 'this', 'these', 'those', 'has', 'have', 'had', 'will', 'can',
  'says', 'say', 'said', 'new', 'now', 'more', 'after', 'about', 'into', 'over'
]);

const SIMILARITY_THRESHOLD = 0.45;

export function clusterItems(items) {
  const clusters = [];

  for (const item of items) {
    const tokens = tokenize(item.title);
    if (!tokens.size) {
      clusters.push(makeCluster(item, tokens));
      continue;
    }

    const signature = modelSignature(item.title);

    const match = clusters.find((cluster) => {
      // A distinctive model signature is stronger evidence than word overlap:
      // "DeepSeek-V4-Flash Update" and "DeepSeek-V4-Flash-0731 is going to
      // cause another market crash" share only 30% of their tokens, yet both
      // name deepseek + flash + v4, so they are one story.
      //
      // The match must involve a NAME though. Matching on version numbers alone
      // merged "prompt caching for GPT-5.6 on Bedrock" with an OpenAI revenue
      // report, because both contained "5" and "6".
      if (signaturesMatch(cluster.signature, signature)) return true;

      // Otherwise fall back to token similarity against the cluster's LEAD.
      // Comparing against the union of every member let a cluster's vocabulary
      // grow until it absorbed anything loosely related.
      if (cluster.subjectSlug !== item.subjectSlug && !sharesNamedOrg(cluster.leadTokens, tokens)) return false;
      return jaccard(cluster.leadTokens, tokens) >= SIMILARITY_THRESHOLD;
    });

    if (match) {
      match.members.push(item);
      // Prefer a first-party account of the event over commentary about it,
      // then fall back to score. A lab's own announcement should lead the story
      // even when a Reddit thread about it scored higher.
      if (preferAsLead(item, match.lead)) {
        match.lead = item;
        match.leadTokens = tokens;
      }
      for (const token of signature.names) match.signature.names.add(token);
      for (const token of signature.versions) match.signature.versions.add(token);
    } else {
      clusters.push(makeCluster(item, tokens, signature));
    }
  }

  return clusters.map((cluster) => {
    const sources = [...new Set(cluster.members.map((m) => m.entityName))];
    return {
      ...cluster.lead,
      // Corroboration is itself a signal: four outlets covering one thing means
      // it matters more than any single report of it.
      score: Math.min(cluster.lead.score + (sources.length - 1) * 6, 100),
      clusterSize: cluster.members.length,
      citations: cluster.members
        .filter((m) => m.url !== cluster.lead.url)
        .map((m) => ({ entity: m.entityName, url: m.url, title: m.title }))
    };
  }).sort((a, b) => b.score - a.score);
}

function makeCluster(item, tokens, signature) {
  return {
    lead: item,
    members: [item],
    leadTokens: new Set(tokens),
    signature: { names: new Set(signature.names), versions: new Set(signature.versions) },
    subjectSlug: item.subjectSlug || item.entitySlug
  };
}

function preferAsLead(candidate, current) {
  const candidateFirstParty = candidate.entityGroup === 'entity';
  const currentFirstParty = current.entityGroup === 'entity';
  if (candidateFirstParty !== currentFirstParty) return candidateFirstParty;
  return candidate.score > current.score;
}

// Distinctive naming tokens: org names, model families and version strings
// ("v4", "4.5", "k3", "70b"). Generic words never enter the signature, so two
// items matching on 2+ of these are almost certainly the same announcement.
const NAME_TOKEN = /^(openai|anthropic|claude|deepseek|qwen|kimi|moonshot|zhipu|glm|minimax|gemini|deepmind|llama|mistral|nvidia|grok|gpt|gemma|sonnet|opus|haiku|flash|turbo|sora)$/i;
// Bare integers are excluded on purpose: "5" and "6" from "GPT-5.6" matched
// every other headline containing a small number.
const VERSION_TOKEN = /^(v\d+(\.\d+)?|\d+\.\d+|[a-z]\d+|\d+[bkm])$/i;

function modelSignature(title) {
  const names = new Set();
  const versions = new Set();
  for (const token of tokenize(title)) {
    const lower = token.toLowerCase();
    if (NAME_TOKEN.test(lower)) names.add(lower);
    else if (VERSION_TOKEN.test(lower)) versions.add(lower);
  }
  return { names, versions, size: names.size + versions.size };
}

// Two items are the same announcement when they share either two distinct
// product names, or one name plus one version — never versions alone.
function signaturesMatch(a, b) {
  const sharedNames = intersect(a.names, b.names);
  if (sharedNames >= 2) return true;
  return sharedNames >= 1 && intersect(a.versions, b.versions) >= 1;
}

function intersect(a, b) {
  let count = 0;
  for (const token of b) if (a.has(token)) count += 1;
  return count;
}

function tokenize(title) {
  return new Set(
    String(title || '')
      .toLowerCase()
      // Hyphens must SPLIT, not survive. Keeping them made "deepseek-v4-flash"
      // a single opaque token that matched nothing, so the model-name signature
      // was empty and three reports of one release stayed three stories.
      .replace(/[^a-z0-9一-鿿\s]/g, ' ')
      .split(/\s+/)
      // Version tokens like "v4" are only 2 chars but are exactly the
      // distinguishing part of a model name, so length alone cannot filter.
      .filter((word) => (word.length > 2 || /^[a-z]?\d/.test(word)) && !STOPWORDS.has(word))
  );
}

// Named organizations/models appearing in both titles is strong evidence the
// two headlines describe the same event even across different feeds.
const NAMED = /(openai|anthropic|claude|deepseek|qwen|kimi|moonshot|zhipu|glm|minimax|gemini|deepmind|llama|mistral|nvidia|grok|gpt)/i;

function sharesNamedOrg(aTokens, bTokens) {
  const namedIn = (tokens) => [...tokens].filter((t) => NAMED.test(t));
  const a = namedIn(aTokens);
  const b = namedIn(bTokens);
  return a.length > 0 && b.length > 0 && a.some((token) => b.includes(token));
}

function jaccard(a, b) {
  let intersection = 0;
  for (const token of b) if (a.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
