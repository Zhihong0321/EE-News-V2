// agy (Google Antigravity CLI, Gemini 3.6 Flash) enrichment provider.
//
// Unlike the HTTP providers, agy is a LOCAL CLI: we spawn it with `-p <prompt>`
// and read the model's answer from stdout. Enrichment is pure text-in/JSON-out,
// so agy's scratch-dir file sandbox is irrelevant here — we never ask it to
// write files, we just parse what it prints. No API key: agy authenticates via
// its own Google sign-in (managed by low-legion's agy-sessions).
//
// Contract matches the other providers: enrich(prompt, article) resolves to
//   { content: <parsed JSON>, rawText, provenance }.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { runAgyAgent } from '../../../src/agy/run-agent.js';
import { resolveAgyBinary } from '../../../src/agy/paths.js';
import { articleCutoffDate } from '../enrichment-prompt.js';
import { validateEnrichment } from '../enrichment-validator.js';
import { cleanCorruptedText } from '../utils.js';

// The account pool now lives in this repo (src/agy). The native runner leases a
// profile, redirects HOME so agy reads that profile's credential, and rotates
// on quota/auth rejection — the job low-legion's run-agy-agent.mjs used to do.
// Setting AGY_ROTATION_RUNNER still forces the old external runner, for hosts
// where the Legion pool is the one that actually holds the accounts.
//
// DEFAULT_MODEL is an id from `agy models`, NOT a display name. The previous
// value here ("Gemini 3.6 Flash (High)") is not accepted by --model at all.
const DEFAULT_MODEL = 'gemini-3.6-flash-high';
const DEFAULT_MAX_CONCURRENT_CALLS = 3;
const DEFAULT_MIN_START_GAP_MS = 4000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

// A process-wide provider instance shares this gate across every article. It
// spaces request starts without sacrificing up to three long-running requests.
export function createAgyCallGate({ maxConcurrent = DEFAULT_MAX_CONCURRENT_CALLS, minStartGapMs = DEFAULT_MIN_START_GAP_MS } = {}) {
  const queue = [];
  let active = 0;
  let lastStartAt = 0;
  let timer = null;

  function drain() {
    if (timer || active >= maxConcurrent || queue.length === 0) return;
    const waitMs = Math.max(0, lastStartAt + minStartGapMs - Date.now());
    if (waitMs > 0) {
      timer = setTimeout(() => { timer = null; drain(); }, waitMs);
      return;
    }
    const job = queue.shift();
    active += 1;
    lastStartAt = Date.now();
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => { active -= 1; drain(); });
    drain();
  }

  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
      });
    },
    rejectPending(error) {
      while (queue.length) queue.shift().reject(error);
    }
  };
}

export function isAgyPoolExhaustedError(error) {
  // Native pool sets this flag directly; the string patterns are the external
  // Legion runner's stderr, still matched so both runners fail over the same.
  if (error?.poolExhausted) return true;
  return /all agy sessions exhausted|no ready agy session \(all cooling down \/ unauth\)|all agy profiles exhausted/i.test(
    String(error?.agyOutput || error?.message || '')
  );
}

function tryParseJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// A parsed reply is only a real enrichment if it carries the structural anchors
// the infographic template needs: the core article object plus at least one
// analytical dimension. An empty {} or a truncated/degenerate object — the agy
// "returned nothing usable" failure mode — fails this and is retried, never
// accepted as a successful enrichment.
function hasEnrichmentShape(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  if (!content.coreNews || typeof content.coreNews !== 'object') return false;
  return Array.isArray(content.dimensions) && content.dimensions.length > 0;
}

// originalTitle and sourceUrl are supposed to be VERBATIM copies of values we
// already hold (the article's title/url). There is no reason to trust the model
// to echo them byte-for-byte — Gemini intermittently rewrites the title, which
// tripped the validator's exact-match check. Stamp the known-correct values in
// deterministically so that whole class of failures can never occur.
function stampVerbatimFields(content, article) {
  if (content?.coreNews && typeof content.coreNews === 'object' && article) {
    content.coreNews.originalTitle = article.title;
    content.coreNews.sourceUrl = article.url;
  }
  return content;
}

// Build the pass-2 "review and perfect" prompt: hand the model its own draft
// plus the concrete validator errors, and ask for a corrected, complete JSON.
function buildPerfectPrompt(basePrompt, draft, validationErrors) {
  const flagged = validationErrors?.length
    ? `\n\nAn automated validator flagged these problems in your draft — FIX every one:\n- ${validationErrors.join('\n- ')}`
    : '\n\nNo automated errors were flagged, but review the draft critically anyway.';
  return `${basePrompt}

You previously produced this DRAFT enrichment JSON for the article above:

${JSON.stringify(draft)}
${flagged}

Now REVIEW the draft and produce a PERFECTED version. Check that: every claim is faithful to the article; every { en, zh } pair is present and non-empty; each metric value is a number or null; there is at least one well-supported dimension; and there is no first-person national deixis ("我国" / "our country") — resolve it to the named place. Strengthen weak insights and add supporting facts the article genuinely supports; do not invent facts. Return ONLY the corrected, complete JSON object — no commentary, no code fences.`;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Mirror of the anthropic provider's guard: drop research sources without a
// usable URL or dated after the article's research cutoff, and strip dangling
// references to them, so one bad source can't fail the whole article. `core`
// (the original article) is always kept.
function sanitizeSources(content, cutoff) {
  if (!content || typeof content !== 'object' || !Array.isArray(content.sources)) return content;
  const kept = [];
  const dropped = new Set();
  for (const source of content.sources) {
    if (source?.id === 'core') { kept.push(source); continue; }
    const publishedAt = String(source?.publishedAt || '');
    const tooNew = cutoff && /^\d{4}-\d{2}-\d{2}/.test(publishedAt) && publishedAt.slice(0, 10) > cutoff;
    if (isHttpUrl(source?.url) && !tooNew) kept.push(source);
    else if (source?.id) dropped.add(source.id);
  }
  if (!dropped.size) return content;
  content.sources = kept;

  const stripRef = (holder) => {
    if (holder && holder.sourceId && dropped.has(holder.sourceId)) delete holder.sourceId;
  };
  for (const dimension of content.dimensions || []) {
    for (const fact of dimension.supportingFacts || []) stripRef(fact);
    for (const metric of dimension.metrics || []) stripRef(metric);
  }
  for (const event of content.timeline || []) stripRef(event);
  return content;
}

export function buildAgyCommand({ bin, runner, useSessionRotation, model, prompt, cwd }) {
  if (useSessionRotation) {
    if (!runner || !existsSync(runner)) {
      throw new Error(`AGY session rotation runner is unavailable: ${runner || '(not configured)'}`);
    }
    return {
      command: process.execPath,
      args: [runner, cwd, model, prompt],
      usesSessionRotation: true
    };
  }
  return {
    command: bin,
    args: ['-p', prompt, '--model', model, '--dangerously-skip-permissions'],
    usesSessionRotation: false
  };
}

// Spawn one AGY request through the EXTERNAL Legion runner (or agy directly).
// Kept for hosts where low-legion still owns the account pool; the native path
// below is what runs by default.
function runAgy({ bin, runner, useSessionRotation, model, prompt, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const { command, args } = buildAgyCommand({ bin, runner, useSessionRotation, model, prompt, cwd });
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8'
    };
    let child;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, cwd, env });
    } catch (error) {
      reject(new Error(`agy spawn failed (is AGY_BIN correct?): ${error.message}`));
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      child.kill();
      const e = new Error(`agy timed out after ${timeoutMs}ms`);
      e.name = 'AbortError';
      reject(e);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdoutChunks.push(d); });
    child.stderr.on('data', (d) => { stderrChunks.push(d); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`agy spawn failed: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      const err = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) return resolve(out);
      const agyOutput = (err || out).trim();
      const e = new Error(`agy failed (exit ${code}): ${agyOutput.slice(0, 300)}`);
      e.agyOutput = agyOutput;
      reject(e);
    });
  });
}

const JSON_RULE = '\n\nReturn ONLY the final JSON object defined in the OUTPUT SCHEMA. No markdown code fences, no commentary before or after — raw JSON only.';

export function createAgyProvider(options = {}) {
  const bin = options.bin || resolveAgyBinary();
  // Native pool unless an external runner is explicitly configured.
  const runner = options.runner ?? process.env.AGY_ROTATION_RUNNER ?? null;
  const useExternalRunner = Boolean(runner) && (options.sessionRotation ?? (process.env.AGY_SESSION_ROTATION !== '0'));
  const model = options.model || process.env.AGY_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || 240000;
  const cwd = options.cwd || process.cwd();
  const maxConcurrent = positiveInteger(options.maxConcurrent ?? process.env.AGY_MAX_CONCURRENCY, DEFAULT_MAX_CONCURRENT_CALLS);
  const minStartGapMs = nonNegativeInteger(options.minStartGapMs ?? process.env.AGY_MIN_INTERVAL_MS, DEFAULT_MIN_START_GAP_MS);
  const agyCallGate = createAgyCallGate({ maxConcurrent, minStartGapMs });
  let exhaustedPoolError = null;
  // Two-pass enrichment by default: pass 1 generates, pass 2 reviews & perfects
  // the draft. Set { refine: false } (or AGY_REFINE=0) for a single generate pass.
  const refine = options.refine ?? (process.env.AGY_REFINE !== '0');

  // One agy call that must yield a shape-valid enrichment JSON, else throws.
  // agy has no separate tool/finalize protocol like the streamed Anthropic path —
  // it is agentic and can research on its own. We ask for JSON-only output and
  // parse stdout.
  async function callForEnrichment(promptText) {
    if (exhaustedPoolError) throw exhaustedPoolError;
    const rawText = await agyCallGate.run(async () => {
      // A queued task may only reach the front after another call exhausted the
      // pool. Skip AGY immediately so its caller can use the next provider.
      if (exhaustedPoolError) throw exhaustedPoolError;
      try {
        if (useExternalRunner) {
          return await runAgy({ bin, runner, useSessionRotation: true, model, prompt: promptText, cwd, timeoutMs });
        }
        const result = await runAgyAgent({ prompt: promptText, model, cwd, timeoutMs });
        return result.text;
      } catch (error) {
        if (isAgyPoolExhaustedError(error)) {
          exhaustedPoolError = error;
          agyCallGate.rejectPending(error);
        }
        throw error;
      }
    });
    const content = tryParseJson(rawText);
    if (content && hasEnrichmentShape(content)) return { content, rawText };
    throw new Error(content
      ? 'agy returned a JSON object with no usable enrichment (missing coreNews/dimensions — empty or degenerate content)'
      : 'agy did not return a JSON object');
  }

  return {
    id: `agy:${model}`,
    async enrich(prompt, article) {
      const cutoff = article ? articleCutoffDate(article) : null;

      // --- Pass 1: generate the draft (must produce a shape-valid object) ---
      let draft;
      let rawText;
      try {
        ({ content: draft, rawText } = await callForEnrichment(prompt + JSON_RULE));
      } catch (error) {
        if (process.env.ENRICH_DEBUG) console.error(`[ENRICH_DEBUG] agy pass 1 (generate) failed: ${error.message}`);
        throw error; // outer retry queue will re-run the whole enrich later
      }
      stampVerbatimFields(draft, article);
      sanitizeSources(draft, cutoff);
      const draftValidation = validateEnrichment(article, draft);

      let final = draft;
      let passes = 1;

      // --- Pass 2: review the draft for mistakes and perfect it ---
      // Best-effort: if the perfect pass fails or comes back worse, keep the
      // draft (it already has shape) so we still render something usable.
      if (refine) {
        try {
          const { content: perfected } = await callForEnrichment(
            buildPerfectPrompt(prompt, draft, draftValidation.errors)
          );
          stampVerbatimFields(perfected, article);
          sanitizeSources(perfected, cutoff);
          const perfectedValidation = validateEnrichment(article, perfected);
          // Accept the perfected version if it is valid, or at least no worse
          // (by error count) than the draft — never regress on a good draft.
          if (perfectedValidation.valid || perfectedValidation.errors.length <= draftValidation.errors.length) {
            final = perfected;
            passes = 2;
          } else if (process.env.ENRICH_DEBUG) {
            console.error(`[ENRICH_DEBUG] pass 2 regressed (draft ${draftValidation.errors.length} -> perfected ${perfectedValidation.errors.length} errors); keeping draft.`);
          }
        } catch (error) {
          if (process.env.ENRICH_DEBUG) console.error(`[ENRICH_DEBUG] agy pass 2 (perfect) failed, keeping draft: ${error.message}`);
        }
      }

      final = cleanCorruptedText(final);
      return {
        content: final,
        rawText,
        provenance: {
          provider: 'agy',
          model,
          responseStatus: 'ok',
          webSearchCalls: 0,
          apiCitations: [],
          passes,
          attempts: passes
        }
      };
    }
  };
}
