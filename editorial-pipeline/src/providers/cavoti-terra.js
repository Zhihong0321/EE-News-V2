import fs from 'node:fs/promises';

const DEFAULT_VAULT_PATH = 'C:\\Users\\Eternalgy\\.hermes\\vault.json';

function parseVaultCredential(vault) {
  const record = vault.credentials?.find((entry) => entry.id === 'Cavoti GPT Model API');
  const raw = String(record?.credential || '');
  const apiKey = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('sk-'));
  const baseUrl = raw.match(/https?:\/\/[^\s]+/)?.[0];
  if (!apiKey || !baseUrl) throw new Error('Hermes credential "Cavoti GPT Model API" is incomplete');
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, '') };
}

async function resolveCredential({ apiKey, baseUrl, vaultPath = DEFAULT_VAULT_PATH } = {}) {
  const resolvedKey = apiKey || process.env.CAVOTI_API_KEY;
  const resolvedUrl = baseUrl || process.env.CAVOTI_BASE_URL;
  if (resolvedKey && resolvedUrl) return { apiKey: resolvedKey, baseUrl: resolvedUrl.replace(/\/$/, '') };
  const vault = JSON.parse(await fs.readFile(vaultPath, 'utf8'));
  return parseVaultCredential(vault);
}

function outputText(payload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text || '')
    .join('\n');
}

function parseJsonOutput(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('Terra did not return a JSON object');
  }
}

function citationAnnotations(payload) {
  const annotations = (payload.output || [])
    .flatMap((item) => item.content || [])
    .flatMap((content) => content.annotations || [])
    .filter((annotation) => annotation.type === 'url_citation');
  const seen = new Set();
  return annotations.map((annotation) => ({
    title: annotation.title || annotation.url_citation?.title || '',
    url: annotation.url || annotation.url_citation?.url || ''
  })).filter((citation) => {
    if (!citation.url || seen.has(citation.url)) return false;
    seen.add(citation.url);
    return true;
  });
}

export function createCavotiTerraProvider(options = {}) {
  const model = options.model || 'gpt-5.6-terra';
  const fetchImpl = options.fetchImpl || fetch;

  return {
    id: model,
    async enrich(prompt) {
      const credential = await resolveCredential(options);
      let lastError = null;
      for (let attempt = 1; attempt <= (options.attempts || 3); attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 240000);
        try {
          const response = await fetchImpl(`${credential.baseUrl}/responses`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${credential.apiKey}`,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              model,
              input: prompt,
              tools: [{ type: 'web_search' }],
              tool_choice: 'auto',
              max_output_tokens: options.maxOutputTokens || 8000
            }),
            signal: controller.signal
          });
          const raw = await response.text();
          let payload;
          try {
            payload = JSON.parse(raw);
          } catch {
            throw new Error(`Cavoti returned non-JSON HTTP ${response.status}`);
          }
          if (!response.ok) {
            const error = new Error(`Cavoti returned HTTP ${response.status}: ${payload.error?.message || 'unknown error'}`);
            error.status = response.status;
            throw error;
          }
          const text = outputText(payload);
          return {
            content: parseJsonOutput(text),
            rawText: text,
            provenance: {
              provider: 'cavoti',
              model,
              responseId: payload.id || null,
              responseStatus: payload.status || null,
              webSearchCalls: (payload.output || []).filter((item) => item.type === 'web_search_call').length,
              apiCitations: citationAnnotations(payload)
            }
          };
        } catch (error) {
          lastError = error;
          const retryable = error.name === 'AbortError' || !error.status || error.status >= 500;
          if (!retryable || attempt === (options.attempts || 3)) throw error;
          await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        } finally {
          clearTimeout(timeout);
        }
      }
      throw lastError;
    }
  };
}
