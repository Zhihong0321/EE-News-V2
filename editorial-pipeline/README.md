# Editorial Pipeline: Research Bench

This subfolder implements the non-editorial web research foundation described
in `../ai-web-research-pipeline-plan.md`.

It exposes two primary operations:

- `search_web(query)` discovers candidate URLs and marks every snippet as
  `discoveryOnly`.
- `fetch_page(url)` routes supported domains to the existing site adapters,
  then uses an isolated Crawl4AI process for unsupported pages or ordinary
  adapter extraction failures.

The bench produces structured JSON only. It does not rewrite articles,
synthesize claims, or generate presentation copy.

## Setup

The JavaScript side uses the repository's existing dependencies.

Install the Python fallback in the subfolder's isolated environment:

```powershell
python -m venv editorial-pipeline/.venv
editorial-pipeline/.venv/Scripts/python.exe -m pip install -r editorial-pipeline/requirements.txt
```

The JavaScript bridge detects this local environment automatically.
Crawl4AI cache and database state are redirected into the ignored
`editorial-pipeline/.runtime/` directory.

Configure Brave Search:

```powershell
$env:BRAVE_SEARCH_API_KEY = "..."
```

For deterministic development, set `RESEARCH_SEARCH_FIXTURE` to a JSON file
instead. The fixture can contain either a top-level `results` array or a
`queries` object keyed by exact query.

## Commands

```powershell
npm run research:search -- "Malaysia solar policy 2026"
npm run research:fetch -- "https://example.com/article"
npm run research:run -- "What changed in Malaysia solar policy?" --documents 5
npm run research:replay -- "editorial-pipeline/output/<session-id>.json"
```

`research:run` may receive repeated `--query` flags for an externally generated
query refinement sequence. An LLM can also import `createResearchBench()` and
call session methods one at a time:

```js
import { createResearchBench } from './editorial-pipeline/src/index.js';

const bench = createResearchBench();
const session = bench.createSession('Research question');
const search = await session.search('first query');
const document = await session.fetch(search.results[0].url);
session.addEvidence({
  documentId: document.id,
  statement: 'A source-grounded statement',
  excerpt: document.excerpts[0],
  evidenceType: 'direct',
  confidence: 'high'
});
session.complete();
await session.save('editorial-pipeline/output');
```

## Infographic Template

`node editorial-pipeline/src/enrich-cli.js <crawler-output.json>` produces an
`infographic_*.json` packet (see `src/enrichment-prompt.js` for the schema:
`coreNews`, `centralInsight`, `dimensions[]`, `timeline[]`, `keyTakeaway`,
`whatToWatch[]`, `uncertainties[]`, `sources[]`, every human-readable field
bilingual `{ en, zh }`).

`templates/infographic/` turns that packet into the standalone bilingual
infographic design (`.dc.html` + `support.js`, EN/中文 toggle, light/dark theme,
scroll-reveal, animated counters and bars). `templates/infographic/render.js`
is the data-driven generator; `templates/infographic/support.js` is the
generic runtime (do not edit — see its own header) that boots the page by
loading React/ReactDOM/Babel from unpkg at view time, so the rendered file
needs internet access to display.

```powershell
node editorial-pipeline/src/render-cli.js editorial-pipeline/output/infographic_<site>-<date>.json --output editorial-pipeline/output
```

This writes one `infographic_<site>-<date>[-N].dc.html` per enriched article
next to a shared `support.js` in the output directory. Each `dimensions[]`
entry's `suggestedPresentation` selects its card layout: `number` (stat
cards, optionally with a comparison bar), `comparison`/`chart` (normalized
bar list), `timeline` (mini vertical timeline), `map` (location callout),
`quote` (pull-quote from the first supporting fact), or `text` (supporting
facts only). Optional flags: `--colorway "Flame Blue|Verdigris|Champagne"`,
`--lang "EN|中文"`.

## Routing And Safety

1. Matching maintained or config-driven site adapter.
2. Crawl4AI fallback with deterministic Markdown extraction.
3. No fallback after HTTP `403` or `429`.
4. Robots checks run before both adapter and Crawl4AI paths.
5. Every document records its fetcher, adapter, fallback reason, retrieval
   timestamp, quality score, metadata, and content hash.

The maintained adapters enforce their existing date rules. A date embedded as
`YYYY/MM/DD` in a URL is passed to the adapter; otherwise the adapter's current
site date is used. If a historical page cannot satisfy that adapter contract,
the recorded fallback handles it.

## Research Packets

Packets include:

- exact queries and normalized search results
- fetched documents and failures
- ordered session events with elapsed time
- request, document, and elapsed-time budgets
- source-linked evidence items
- content hashes for network-free replay verification

Evidence excerpts must occur in the fetched document text. Search snippets
cannot be entered directly into the evidence ledger.

## Benchmarks

`benchmarks/cases.example.json` documents the benchmark case format. Use
`runBenchmark()` from `src/benchmark.js` with a configured bench and a local
case set. Live benchmark URLs are deliberately not run by the automated tests.

Run all local contracts with:

```powershell
npm test
```

## Infographic Enrichment

The enrichment stage consumes an existing crawler output file and uses
`gpt-5.6-terra` to prepare structured text and numerical content for a later
HTML infographic renderer:

```powershell
npm run infographic:enrich -- "output/pv-magazine-2026-07-16.json"
```

The output is written beside the crawler file with the required prefix:

```text
output/infographic_pv-magazine-2026-07-16.json
```

Useful controls:

```powershell
npm run infographic:enrich -- "output/pv-magazine-2026-07-16.json" --limit 1
npm run infographic:enrich -- "output/pv-magazine-2026-07-16.json" --output "editorial-pipeline/output"
npm run infographic:enrich -- "output/pv-magazine-2026-07-16.json" --concurrency 2
```

Concurrency defaults to `1` to limit model cost and avoid upstream timeouts.
Each output article contains:

- the untouched crawler article under `coreNews`
- Terra's structured content under `infographicContent`
- prompt hash, model, web-search count, citations, and timing under `provenance`
- schema, source-reference, and research-cutoff checks under `validation`

Malformed responses remain in the packet with `status: "invalid"` and API
failures use `status: "failed"`. Only validated articles contribute to the
packet's `count`.
