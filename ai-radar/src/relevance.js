// Relevance gate and signal classification.
//
// Aggregator feeds (Hacker News, Reddit, TechCrunch, Techmeme) carry everything
// their audience cares about, which is far wider than AI. Without a gate the
// report fills with saber-toothed cats, OpenJDK proposals and GeForce NOW
// gaming promos — all real items from real AI-adjacent sources, none of them
// AI news.
//
// First-party channels are trusted: if OpenAI publishes it on their newsroom or
// pushes a model to their HF org, it is on-topic by construction.

const ORGS = [
  'openai', 'anthropic', 'deepmind', 'google ai', 'meta ai', 'microsoft ai', 'xai',
  'mistral', 'nvidia', 'hugging ?face', 'perplexity', 'cohere', 'stability ai',
  'deepseek', 'qwen', 'alibaba cloud', 'moonshot', 'kimi', 'zhipu', 'z\\.ai',
  'minimax', 'bytedance', 'doubao', 'baidu', 'ernie', 'tencent', 'hunyuan',
  'internlm', 'stepfun', '01\\.ai', 'iflytek', 'sakana', 'ai21', 'runway',
  'elevenlabs', 'midjourney', 'databricks', 'groq', 'cerebras', 'scale ai'
];

const MODELS = [
  'gpt', 'chatgpt', 'claude', 'gemini', 'llama', 'mistral', 'mixtral', 'qwen',
  'deepseek', 'kimi', 'glm', 'yi-', 'ernie', 'hunyuan', 'grok', 'phi-\\d',
  'gemma', 'command r', 'sonnet', 'opus', 'haiku', 'o\\d-(mini|preview)', 'sora',
  'midjourney', 'stable diffusion', 'flux', 'whisper', 'codex', 'copilot'
];

const CONCEPTS = [
  '\\bai\\b', '\\ba\\.i\\.', 'artificial intelligence', 'machine learning',
  '\\bllm\\b', '\\bllms\\b', 'large language model', 'foundation model',
  'frontier model', 'language model', 'multimodal', 'transformer',
  'neural network', 'deep learning', 'generative ai', 'genai',
  'fine-?tun', 'inference', 'open ?weights?', 'model weights', 'benchmark',
  'agentic', '\\bagent\\b', '\\bagents\\b', '\\brag\\b', 'embedding',
  'diffusion model', 'reinforcement learning', '\\brlhf\\b', 'alignment',
  'context window', 'token', 'quantiz', 'moe\\b', 'mixture of experts',
  '\\bgpu\\b', 'tpu\\b', 'training run', 'pretrain', 'superintelligence', '\\bagi\\b'
];

const AI_PATTERN = new RegExp(`(${[...ORGS, ...MODELS, ...CONCEPTS].join('|')})`, 'i');

// Topics that repeatedly surface on AI-adjacent feeds but are not AI news.
// Only applied when nothing above matched strongly.
const OFF_TOPIC = new RegExp(
  '(saber-?tooth|paleo|dinosaur|astronomy|climate|recipe|'
  + 'geforce now|cloud gaming|game pass|steam deck|'
  + 'openjdk|\\bjvm\\b|\\bjep \\d+|kubernetes|postgres|sqlite|'
  + 'surveillance pricing|chrome bugs?|browser bug)',
  'i'
);

// Channels whose publisher IS the subject — everything they post is on-topic.
const FIRST_PARTY_KINDS = new Set(['hf_models', 'github_releases']);

export function isRelevant(item, source) {
  // First-party: an entity's own newsroom, model uploads or release tags.
  if (source.group === 'entity' && FIRST_PARTY_KINDS.has(source.kind)) return true;
  if (source.group === 'entity' && source.kind !== 'rss') return true;

  const text = `${item.title || ''} ${item.summary || ''}`;

  // An entity's own RSS can still be broad (Nvidia's blog covers gaming, AWS's
  // covers general cloud), so those are gated like any aggregator.
  if (AI_PATTERN.test(text)) {
    // A single weak "agent"/"token" hit inside an obviously off-topic story
    // should not pass.
    if (OFF_TOPIC.test(text) && !strongSignal(text)) return false;
    return true;
  }
  return false;
}

// Named orgs and models are strong evidence; generic concept words are not.
function strongSignal(text) {
  const strong = new RegExp(`(${[...ORGS, ...MODELS].join('|')})`, 'i');
  return strong.test(text);
}

// Vendor how-to content ("Deploying Kimi K3 on AWS", "Getting started with
// Bedrock") passes the relevance gate — it is genuinely about AI — but it is
// documentation, not news. It ranked #1 and #2 before this existed.
const TUTORIAL = new RegExp(
  '(^|\\b)(how to|deploying|deploy |building |build a |getting started|'
  + 'a guide to|guide:|tutorial|walkthrough|best practices|tips for|'
  + 'introduction to|learn how|step[- ]by[- ]step|using .{3,30} to (build|create|deploy))',
  'i'
);

export function isTutorial(item) {
  return TUTORIAL.test(`${item.title || ''}`);
}

// Ordered most-specific first: a release announcement that also says "benchmark"
// is a release, not research.
// Each rule is [type, pattern, requiredContext?]. When a context pattern is
// present BOTH must match — that is what stops "Introducing inference
// meta-monitoring for SageMaker endpoints" from being filed as a model launch
// on the strength of the word "introducing" alone.
const MODEL_CONTEXT = /(model|\bllm\b|weights?|checkpoint|gpt|claude|gemini|llama|qwen|deepseek|kimi|glm|mistral|grok|gemma|sonnet|opus|haiku|\bv\d+(\.\d+)?\b|\b\d+b\b|flash|turbo)/i;

const SIGNAL_RULES = [
  ['model_release',
    /(\brelease[sd]?\b|\blaunch(es|ed|ing)?\b|\bintroduc(e|es|ing)\b|now available|open[- ]?sourc|weights? (are|now)|available on the api|\bships?\b|\bunveil)/i,
    MODEL_CONTEXT],
  ['funding',
    /(\braises?\b|\braised\b|funding round|series [a-e]\b|valuation|\bipo\b|acquir(e|es|ed|ing)|acquisition|invests?|investment|\bfunding\b)/i],
  ['policy',
    /(regulat|lawsuit|\bsues?\b|\bsued\b|court|judge|\bban\b|banned|compliance|antitrust|export control|copyright)/i],
  ['research',
    /(\bpaper\b|arxiv|\bstudy finds\b|research(ers)? (find|show|report)|benchmark results?|state[- ]of[- ]the[- ]art|\bsota\b|ablation|evaluation suite)/i],
  ['product',
    /(\bfeature\b|\bapp\b|integration|\bapi\b|pricing|\bpartnership\b|rolls? out|\bpreview\b|update[sd]?\b)/i]
];

export function classifySignal(item, source) {
  if (source.kind === 'hf_models' || source.kind === 'github_releases') return 'model_release';

  // Documentation is never a release, whatever verbs it uses.
  if (isTutorial(item)) return 'guide';

  // Classification runs on the TITLE. Long marketing summaries nearly always
  // contain the word "model" somewhere, which let "Inference meta-monitoring
  // for SageMaker endpoints" satisfy the model-release context check and take
  // the top slot in the report.
  const title = item.title || '';
  for (const [type, pattern, context] of SIGNAL_RULES) {
    if (!pattern.test(title)) continue;
    if (context && !context.test(title)) continue;
    return type;
  }
  return 'other';
}

// Which organization a story is ABOUT, which is not always who published it.
// A Reddit thread announcing DeepSeek V4 is a DeepSeek story and should be
// weighted as one — otherwise first-party vendor blogs outrank every genuine
// frontier release that happens to surface via an aggregator first.
const SUBJECTS = [
  ['openai', /\b(openai|chatgpt|gpt-?\d|sora|codex)\b/i, 1, 'OpenAI'],
  ['anthropic', /\b(anthropic|claude)\b/i, 1, 'Anthropic'],
  ['google-deepmind', /\b(google|deepmind|gemini|gemma)\b/i, 1, 'Google DeepMind'],
  ['deepseek', /\bdeepseek\b/i, 1, 'DeepSeek'],
  ['qwen', /\b(qwen|alibaba|tongyi)\b/i, 1, 'Alibaba Qwen'],
  ['moonshot', /\b(moonshot|kimi)\b/i, 1, 'Moonshot AI'],
  ['zhipu', /\b(zhipu|z\.ai|\bglm\b)\b/i, 1, 'Zhipu AI'],
  ['minimax', /\bminimax\b/i, 1, 'MiniMax'],
  ['meta-ai', /\b(meta ai|llama)\b/i, 1, 'Meta AI'],
  ['xai', /\b(xai|grok)\b/i, 1, 'xAI'],
  ['mistral', /\b(mistral|mixtral)\b/i, 1, 'Mistral AI'],
  ['bytedance-seed', /\b(bytedance|doubao|seedance|seedream)\b/i, 1, 'ByteDance'],
  ['nvidia', /\bnvidia\b/i, 2, 'Nvidia'],
  ['microsoft-ai', /\b(microsoft|copilot)\b/i, 2, 'Microsoft']
];

export function detectSubject(item) {
  const title = item.title || '';
  for (const [slug, pattern, tier, name] of SUBJECTS) {
    if (pattern.test(title)) return { slug, tier, name };
  }
  return null;
}
