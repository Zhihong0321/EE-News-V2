// Anthropic-compatible provider (works with api.anthropic.com or a compatible
// proxy such as cavoti.com). Credentials come ONLY from the environment:
//   ANTHROPIC_BASE_URL   e.g. https://cavoti.com/  (or https://api.anthropic.com)
//   ANTHROPIC_AUTH_TOKEN e.g. sk-...               (sent as x-api-key)
//   ANTHROPIC_MODEL      e.g. claude-sonnet-5      (overridable per call)
// No secrets are ever hard-coded here.
//
// Requests are STREAMED (SSE). Long bilingual generations otherwise exceed the
// proxy's gateway timeout and return Cloudflare 524; streaming keeps the
// connection busy with incremental tokens so the gateway never times out.
import { articleCutoffDate } from '../enrichment-prompt.js';

function resolveCredential(options = {}) {
  const baseUrl = (options.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const token = options.authToken || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
  if (!token) throw new Error('ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) is not set');
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

export function createAnthropicProvider(options = {}) {
  const model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const fetchImpl = options.fetchImpl || fetch;
  const attempts = options.attempts || 3;
  const useWebSearch = options.webSearch !== false;
  const maxOutputTokens = options.maxOutputTokens || 32000;

  return {
    id: model,
    async enrich(prompt, article) {
      const { baseUrl, token } = resolveCredential(options);
      const cutoff = article ? articleCutoffDate(article) : null;

      // One streamed call to the messages endpoint, with retry/backoff.
      // Returns { text, stopReason, usage, webSearchCalls, citations }.
      async function callApi(body) {
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 300000);
          try {
            const response = await fetchImpl(`${baseUrl}/v1/messages`, {
              method: 'POST',
              headers: {
                'x-api-key': token,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                accept: 'text/event-stream'
              },
              body: JSON.stringify({ ...body, stream: true }),
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
            let stopReason = null;
            let usage = null;
            let webSearchCalls = 0;
            const citations = [];
            const seen = new Set();
            const decoder = new TextDecoder();
            let buffer = '';

            const handle = (event) => {
              switch (event.type) {
                case 'message_start':
                  if (event.message?.usage) usage = event.message.usage;
                  break;
                case 'content_block_start':
                  if (event.content_block?.type === 'server_tool_use') webSearchCalls += 1;
                  break;
                case 'content_block_delta':
                  if (event.delta?.type === 'text_delta') text += event.delta.text || '';
                  if (event.delta?.type === 'citations_delta' && event.delta.citation?.url) {
                    const url = event.delta.citation.url;
                    if (!seen.has(url)) {
                      seen.add(url);
                      citations.push({ title: event.delta.citation.title || '', url });
                    }
                  }
                  break;
                case 'message_delta':
                  if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
                  if (event.usage) usage = { ...(usage || {}), ...event.usage };
                  break;
                case 'error':
                  throw new Error(`Stream error: ${event.error?.message || 'unknown'}`);
                default:
                  break;
              }
            };

            for await (const chunk of response.body) {
              buffer += decoder.decode(chunk, { stream: true });
              let nl;
              while ((nl = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, nl).trim();
                buffer = buffer.slice(nl + 1);
                if (!line.startsWith('data:')) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let event;
                try { event = JSON.parse(data); } catch { continue; }
                handle(event);
              }
            }
            return { text, stopReason, usage, webSearchCalls, citations };
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

      // Step 1 — research call (web search allowed). The model may narrate its
      // findings as prose instead of emitting JSON; that is expected.
      const researchBody = {
        model,
        max_tokens: maxOutputTokens,
        messages: [{ role: 'user', content: prompt }]
      };
      if (useWebSearch) {
        researchBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: options.maxWebSearches || 5 }];
      }
      const research = await callApi(researchBody);

      // If the research turn already produced valid JSON, use it directly.
      let content = tryParseJson(research.text);
      let finalizeUsage = null;

      // Step 2 — finalize call (no tools). Force JSON-only output using the
      // research gathered above. Only runs when step 1 did not yield JSON.
      if (!content) {
        // Give the model the exact URLs it surfaced during research, so source
        // entries carry real http(s) URLs instead of empty strings.
        const citationList = (research.citations || [])
          .slice(0, 20)
          .map((c, i) => `${i + 1}. ${c.title || '(untitled)'} — ${c.url}`)
          .join('\n');
        const sourceRule = citationList
          ? `Every source's "url" MUST be a real http(s) URL. Use these exact URLs found during research where relevant:\n${citationList}\nNever leave a source "url" empty — if you cannot attach a real URL to a source, omit that source entirely. Always keep the "core" source with the original article URL.`
          : 'Every source\'s "url" MUST be a real http(s) URL. Never leave a source "url" empty — if you cannot attach a real URL, omit that source. Always keep the "core" source with the original article URL.';

        const finalizeMessages = [
          { role: 'user', content: prompt },
          { role: 'assistant', content: research.text || '(research completed)' },
          {
            role: 'user',
            content: `Now output ONLY the final JSON object defined in the OUTPUT SCHEMA, using the research above as evidence. Fill every { "en", "zh" } pair in both languages. ${sourceRule} Return raw JSON with no commentary, no explanation, and no markdown code fences.`
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
          let stopReason = finalize.stopReason;
          content = tryParseJson(accumulated);

          for (let cont = 0; !content && stopReason === 'max_tokens' && cont < 2; cont += 1) {
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
            stopReason = continuation.stopReason;
            if (continuation.usage) finalizeUsage = { ...(finalizeUsage || {}), ...continuation.usage };
            content = tryParseJson(accumulated);
          }

          if (!content) lastDebug = { attempt, stopReason, len: accumulated.length, head: accumulated.slice(0, 200), tail: accumulated.slice(-400) };
        }

        if (!content) {
          if (process.env.ENRICH_DEBUG && lastDebug) {
            console.error(`[ENRICH_DEBUG] finalize failed after ${finalizeAttempts} attempts: stopReason=${lastDebug.stopReason} len=${lastDebug.len} head=${JSON.stringify(lastDebug.head)} tail=${JSON.stringify(lastDebug.tail)}`);
          }
          throw new Error('Model did not return a JSON object after finalize step');
        }
      }

      // Drop research sources the model left without a usable URL or dated after
      // the research cutoff (and any dangling references to them), so a single
      // bad source can't fail the article.
      content = sanitizeSources(content, cutoff);

      return {
        content,
        rawText: research.text,
        provenance: {
          provider: 'anthropic',
          model,
          responseStatus: research.stopReason || null,
          webSearchCalls: research.webSearchCalls,
          finalizeUsed: Boolean(finalizeUsage),
          apiCitations: research.citations,
          usage: research.usage || null,
          finalizeUsage
        }
      };
    }
  };
}
