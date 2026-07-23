import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const ARTICLE_FILE = path.join(REPO_ROOT, 'output', 'pv-magazine-2026-07-16.json');
const ARTICLE_INDEX = 0;
const VAULT_FILE = 'C:\\Users\\Eternalgy\\.hermes\\vault.json';
const MODELS = [
  { id: 'gpt-5.6-sol', output: 'by-sol.md' },
  { id: 'gpt-5.6-terra', output: 'by-terra.md' },
  { id: 'gpt-5.6-luna', output: 'by-luna.md' }
];

function parseCavotiCredential(vault) {
  const record = vault.credentials.find((entry) => entry.id === 'Cavoti GPT Model API');
  const raw = String(record?.credential || '');
  const token = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('sk-'));
  const baseUrl = raw.match(/https?:\/\/[^\s]+/)?.[0];
  if (!token || !baseUrl) throw new Error('Cavoti GPT Model API credential is incomplete');
  return { token, baseUrl: baseUrl.replace(/\/$/, '') };
}

function buildPrompt(article) {
  return `You are a research editor preparing content for a multi-dimensional news infographic.

CORE NEWS
Title: ${article.title}
Publisher: ${article.source}
Author: ${article.author || 'Unknown'}
Published date: ${article.published_at}
Source URL: ${article.url}
Section: ${article.section || 'Unknown'}
Article text:
${article.body}

OBJECTIVE
Prepare concise, evidence-based content for a multi-dimensional infographic centered on the Core News.

YOUR SCOPE
- Preserve the Core News and its essential facts.
- Research directly related supporting information using web search.
- Add useful context, comparisons, timelines, statistics, causes, consequences, counterpoints, and future signals.
- Produce slide-ready text and structured numerical data.
- Include source citations for every supporting claim.

NOT YOUR SCOPE
- Do not create HTML, CSS, visual layouts, or finished infographic designs.
- Do not replace the Core News with a different story.
- Do not write a conventional long-form article.
- Do not add unrelated information merely because it concerns the same industry or country.

EDITORIAL RULES
1. Keep the Core News intact and clearly separate it from enrichment.
2. Every supporting item must have a direct relationship to the Core News:
   - historical-context
   - comparison
   - cause
   - consequence
   - stakeholder-impact
   - contradiction
   - future-signal
3. Do not claim causation unless reliable sources explicitly support it.
4. Distinguish verified facts, reported claims, analysis, and uncertainty.
5. Use absolute dates and identify the period represented by every number.
6. Compare equivalent measurements. Do not compare incompatible statistics.
7. Prefer primary sources, official data, and reputable reporting.
8. If reliable supporting evidence is unavailable, omit the dimension.
9. Keep text concise and suitable for infographic panels.
10. Never use search snippets as final evidence without inspecting the source.
11. Treat July 16, 2026 as the research cutoff. Do not include information published after that date.
12. Return valid JSON only, with no Markdown fences or introductory prose.

OUTPUT SCHEMA
{
  "coreNews": {
    "originalTitle": "",
    "publisher": "",
    "publishedAt": "",
    "sourceUrl": "",
    "summary": "",
    "keyFacts": [
      {
        "text": "",
        "sourceId": "core"
      }
    ]
  },
  "centralInsight": "",
  "dimensions": [
    {
      "title": "",
      "relationship": "historical-context|comparison|cause|consequence|stakeholder-impact|contradiction|future-signal",
      "insight": "",
      "supportingFacts": [
        {
          "text": "",
          "sourceId": "",
          "confidence": "high|medium|low"
        }
      ],
      "metrics": [
        {
          "label": "",
          "value": null,
          "unit": "",
          "period": "",
          "comparisonValue": null,
          "comparisonPeriod": "",
          "sourceId": ""
        }
      ],
      "suggestedPresentation": "number|comparison|timeline|chart|map|quote|text"
    }
  ],
  "timeline": [
    {
      "date": "",
      "event": "",
      "sourceId": ""
    }
  ],
  "keyTakeaway": "",
  "whatToWatch": [],
  "uncertainties": [],
  "sources": [
    {
      "id": "",
      "title": "",
      "publisher": "",
      "publishedAt": "",
      "url": ""
    }
  ]
}`;
}

function responseText(payload) {
  if (payload.output_text) return payload.output_text;
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text || '')
    .join('\n');
}

function responseCitations(payload) {
  const citations = (payload.output || [])
    .flatMap((item) => item.content || [])
    .flatMap((content) => content.annotations || [])
    .filter((annotation) => annotation.type === 'url_citation');
  const seen = new Set();
  return citations.filter((citation) => {
    const url = citation.url || citation.url_citation?.url;
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).map((citation) => ({
    title: citation.title || citation.url_citation?.title || '',
    url: citation.url || citation.url_citation?.url
  }));
}

async function waitForBackgroundResponse(payload, credential, modelId) {
  let current = payload;
  for (let poll = 0; poll < 120; poll += 1) {
    if (!['queued', 'in_progress'].includes(current.status)) return current;
    if (!current.id) throw new Error(`${modelId} background response did not include an ID`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const response = await fetch(`${credential.baseUrl}/responses/${current.id}`, {
      headers: { authorization: `Bearer ${credential.token}` }
    });
    const raw = await response.text();
    try {
      current = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!response.ok) throw new Error(`${modelId} background poll returned HTTP ${response.status}`);
  }
  throw new Error(`${modelId} background response did not finish within 10 minutes`);
}

async function runModel(model, prompt, credential) {
  const startedAt = new Date();
  let payload;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${credential.baseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model.id,
        input: prompt,
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        max_output_tokens: 8000,
        background: model.id === 'gpt-5.6-sol'
      })
    });
    const raw = await response.text();
    try {
      payload = JSON.parse(raw);
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
        continue;
      }
      throw new Error(`${model.id} returned non-JSON API output: ${raw.slice(0, 300)}`);
    }
    if (response.ok) break;
    if (response.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
      continue;
    }
    throw new Error(`${model.id} returned HTTP ${response.status}: ${payload.error?.message || raw.slice(0, 300)}`);
  }
  payload = await waitForBackgroundResponse(payload, credential, model.id);
  if (payload.status === 'failed') {
    throw new Error(`${model.id} background response failed: ${payload.error?.message || 'unknown error'}`);
  }

  const text = responseText(payload);
  const citations = responseCitations(payload);
  const webSearchCalls = (payload.output || []).filter((item) => item.type === 'web_search_call').length;
  const elapsedSeconds = ((new Date() - startedAt) / 1000).toFixed(1);
  const markdown = `# ${model.id} News Enrichment

## Core Article

- **Title:** ${article.title}
- **Publisher:** ${article.source}
- **Published:** ${article.published_at}
- **URL:** ${article.url}
- **Prompt SHA-256:** \`${promptHash}\`

## Model Output

\`\`\`json
${text}
\`\`\`

## Run Metadata

- Web-search calls: ${webSearchCalls}
- API citations: ${citations.length}
- Elapsed time: ${elapsedSeconds} seconds
- Response status: ${payload.status || 'unknown'}

## API Citations

${citations.length ? citations.map((citation) => `- [${citation.title || citation.url}](${citation.url})`).join('\n') : 'No API citation annotations returned.'}
`;
  await fs.writeFile(path.join(REPO_ROOT, model.output), markdown, 'utf8');
  return { model: model.id, output: model.output, webSearchCalls, citations: citations.length, elapsedSeconds, textLength: text.length };
}

async function runSolChatModel(model, prompt, credential) {
  const startedAt = new Date();
  const response = await fetch(`${credential.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${credential.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: 'user', content: prompt }],
      web_search_options: { search_context_size: 'high' },
      max_completion_tokens: 6000
    })
  });
  const raw = await response.text();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`${model.id} chat route returned non-JSON API output: ${raw.slice(0, 300)}`);
  }
  if (!response.ok) throw new Error(`${model.id} chat route returned HTTP ${response.status}: ${payload.error?.message || raw.slice(0, 300)}`);

  const message = payload.choices?.[0]?.message || {};
  const text = message.content || '';
  const citations = (message.annotations || [])
    .filter((annotation) => annotation.type === 'url_citation')
    .map((annotation) => annotation.url_citation || annotation);
  const elapsedSeconds = ((new Date() - startedAt) / 1000).toFixed(1);
  const markdown = `# ${model.id} News Enrichment

## Core Article

- **Title:** ${article.title}
- **Publisher:** ${article.source}
- **Published:** ${article.published_at}
- **URL:** ${article.url}
- **Prompt SHA-256:** \`${promptHash}\`

## Model Output

\`\`\`json
${text}
\`\`\`

## Run Metadata

- API route: Chat Completions with web search options
- API citations: ${citations.length}
- Elapsed time: ${elapsedSeconds} seconds
- Response status: ${payload.choices?.[0]?.finish_reason || 'unknown'}

## API Citations

${citations.length ? citations.map((citation) => `- [${citation.title || citation.url}](${citation.url})`).join('\n') : 'No API citation annotations returned by the Sol chat route. Inspect the model output sources directly.'}
`;
  await fs.writeFile(path.join(REPO_ROOT, model.output), markdown, 'utf8');
  return { model: model.id, output: model.output, webSearchCalls: null, citations: citations.length, elapsedSeconds, textLength: text.length, apiRoute: 'chat/completions' };
}

const [vault, articleDocument] = await Promise.all([
  fs.readFile(VAULT_FILE, 'utf8').then(JSON.parse),
  fs.readFile(ARTICLE_FILE, 'utf8').then(JSON.parse)
]);
const article = articleDocument.articles[ARTICLE_INDEX];
if (!article?.title || !article?.body) throw new Error('Selected article is missing a title or body');
const credential = parseCavotiCredential(vault);
const prompt = buildPrompt(article);
const promptHash = createHash('sha256').update(prompt).digest('hex');
const requestedModelIds = process.argv.slice(2);
const selectedModels = requestedModelIds.length
  ? MODELS.filter((model) => requestedModelIds.includes(model.id))
  : MODELS;
if (selectedModels.length === 0) throw new Error(`Unknown model selection: ${requestedModelIds.join(', ')}`);
const results = await Promise.all(selectedModels.map((model) => (
  model.id === 'gpt-5.6-sol'
    ? runSolChatModel(model, prompt, credential)
    : runModel(model, prompt, credential)
)));
console.log(JSON.stringify({ article: article.title, promptHash, results }, null, 2));
