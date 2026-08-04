// OpenAI-standard chat-completions provider (works with api.openai.com or any
// compatible endpoint such as StepFun). Credentials come ONLY from the
// environment:
//   OPENAI_BASE_URL  e.g. https://api.stepfun.com  (or https://api.openai.com)
//   OPENAI_API_KEY   e.g. sk-...                   (sent as a Bearer token)
//   OPENAI_MODEL     e.g. step-3.7-flash           (overridable per call)
// No secrets are ever hard-coded here.
//
// Requests are STREAMED (SSE). Long bilingual generations otherwise exceed a
// proxy's gateway timeout and return Cloudflare 524; streaming keeps the
// connection busy with incremental tokens so the gateway never times out.
//
// NO SERVER-SIDE TOOLS. The chat-completions standard has no portable
// web-search tool, so enrichment works from the article itself. The validator
// only requires the "core" source — external sources are a warning, not an
// error — so the pipeline still completes without external research.
import { articleCutoffDate } from '../enrichment-prompt.js';

function resolveCredential(options = {}) {
  const baseUrl = (options.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '');
  const token = options.authToken || process.env.OPENAI_API_KEY;
  if (!token) throw new Error('OPENAI_API_KEY is not set');
  return { baseUrl, token };
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

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// The model sometimes emits unusable research sources: an empty/non-URL `url`
// (e.g. { id: "s1", publisher: "...", url: "" }) or a `publishedAt` dated after
// the article's research cutoff (fabricated/anachronistic expert sources). The
// validator rejects both, which would sink the whole article. Drop those
// non-core sources and strip every sourceId reference that pointed at them, so
// what remains still validates. `core` (the original article) is always kept.
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

export function createOpenAiProvider(options = {}) {
  const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const fetchImpl = options.fetchImpl || fetch;
  const attempts = options.attempts || 3;
  const maxOutputTokens = options.maxOutputTokens || 32000;

  return {
    id: model,
    async enrich(prompt, article) {
      const { baseUrl, token } = resolveCredential(options);
      const cutoff = article ? articleCutoffDate(article) : null;

      // One streamed call to the chat-completions endpoint, with retry/backoff.
      // Returns { text, finishReason, usage }.
      async function callApi(body) {
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 300000);
          try {
            const response = await fetchImpl(`${baseUrl}/v1/chat/completions`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                accept: 'text/event-stream'
              },
              body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
              signal: controller.signal
            });
            if (!response.ok) {
              const raw = await response.text().catch(() => '');
              let message = raw.slice(0, 200);
              try { message = JSON.parse(raw).error?.message || message; } catch { /* keep raw */ }
              const error = new Error(`Provider returned HTTP ${response.status}: ${message}`);
              error.status = response.status;
              throw error;
            }
            if (!response.body) throw new Error('Provider returned an empty stream');

            let text = '';
            let finishReason = null;
            let usage = null;
            const decoder = new TextDecoder();
            let buffer = '';

            // A chunk carries usage only on the final (choice-less) frame when
            // stream_options.include_usage is honoured; endpoints that ignore
            // the flag simply leave usage null.
            const handle = (chunk) => {
              if (chunk.error) throw new Error(`Stream error: ${chunk.error.message || 'unknown'}`);
              if (chunk.usage) usage = chunk.usage;
              const choice = chunk.choices?.[0];
              if (!choice) return;
              // Reasoning models stream their thinking in `reasoning_content`;
              // only `content` is the answer.
              if (typeof choice.delta?.content === 'string') text += choice.delta.content;
              if (choice.finish_reason) finishReason = choice.finish_reason;
            };

            for await (const piece of response.body) {
              buffer += decoder.decode(piece, { stream: true });
              let nl;
              while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let chunk;
                try { chunk = JSON.parse(data); } catch { continue; }
                handle(chunk);
              }
            }
            return { text, finishReason, usage };
          } catch (error) {
            lastError = error;
            const retryable = error.name === 'AbortError' || !error.status || error.status >= 500 || error.status === 429;
            if (!retryable || attempt === attempts) throw error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
          } finally {
            clearTimeout(timeout);
          }
        }
        throw lastError;
      }

      // Step 1 — reasoning call. The model may narrate its analysis as prose
      // instead of emitting JSON; that is expected.
      const research = await callApi({
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: 'user', content: prompt }]
      });

      // If the first turn already produced valid JSON, use it directly.
      let content = tryParseJson(research.text);
      let finalizeUsage = null;

      // Step 2 — finalize call. Force JSON-only output using the analysis
      // above. Only runs when step 1 did not yield JSON.
      if (!content) {
        const sourceRule = 'Every source\'s "url" MUST be a real http(s) URL taken from the article itself. Never invent a URL and never leave a source "url" empty — if you cannot attach a real URL, omit that source. Always keep the "core" source with the original article URL.';

        const finalizeMessages = [
          { role: 'user', content: prompt },
          { role: 'assistant', content: research.text || '(analysis completed)' },
          {
            role: 'user',
            content: `Now output ONLY the final JSON object defined in the OUTPUT SCHEMA, using the analysis above as evidence. Fill every { "en", "zh" } pair in both languages. ${sourceRule} Return raw JSON with no commentary, no explanation, and no markdown code fences.`
          }
        ];

        // The finalize turn is intermittently non-JSON — the model sometimes
        // narrates prose or truncates mid-object. Retry the whole finalize a few
        // times, and within each attempt, if the stream stopped for length,
        // continue the JSON where it left off before giving up on that attempt.
        const finalizeAttempts = options.finalizeAttempts || 3;
        let lastDebug = null;
        for (let attempt = 1; !content && attempt <= finalizeAttempts; attempt += 1) {
          const finalize = await callApi({ model, max_tokens: maxOutputTokens, messages: finalizeMessages });
          finalizeUsage = finalize.usage || finalizeUsage;
          let accumulated = finalize.text;
          let finishReason = finalize.finishReason;
          content = tryParseJson(accumulated);

          for (let cont = 0; !content && finishReason === 'length' && cont < 2; cont += 1) {
            const continuation = await callApi({
              model,
              max_tokens: maxOutputTokens,
              messages: [
                ...finalizeMessages,
                { role: 'assistant', content: accumulated },
                { role: 'user', content: 'Continue the JSON output exactly where you left off. Do not repeat any earlier content and do not add commentary — output only the remaining raw JSON.' }
              ]
            });
            accumulated += continuation.text;
            finishReason = continuation.finishReason;
            if (continuation.usage) finalizeUsage = { ...(finalizeUsage || {}), ...continuation.usage };
            content = tryParseJson(accumulated);
          }

          if (!content) lastDebug = { attempt, finishReason, len: accumulated.length, head: accumulated.slice(0, 200), tail: accumulated.slice(-400) };
        }

        if (!content) {
          if (process.env.ENRICH_DEBUG && lastDebug) {
            console.error(`[ENRICH_DEBUG] finalize failed after ${finalizeAttempts} attempts: finishReason=${lastDebug.finishReason} len=${lastDebug.len} head=${JSON.stringify(lastDebug.head)} tail=${JSON.stringify(lastDebug.tail)}`);
          }
          throw new Error('Model did not return a JSON object after finalize step');
        }
      }

      // Drop sources the model left without a usable URL or dated after the
      // research cutoff (and any dangling references to them), so a single bad
      // source can't fail the article.
      content = sanitizeSources(content, cutoff);

      return {
        content,
        rawText: research.text,
        provenance: {
          provider: 'openai',
          model,
          responseStatus: research.finishReason || null,
          finalizeUsed: Boolean(finalizeUsage),
          usage: research.usage || null,
          finalizeUsage
        }
      };
    }
  };
}
