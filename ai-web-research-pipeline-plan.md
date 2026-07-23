# AI Web Research Pipeline Plan

## Direction

Build the web-research foundation before building anything editorial.

The LLM should first receive two reliable capabilities, or "hands":

1. A search hand for finding relevant sources.
2. A fetch hand for opening, rendering, extracting, and preserving source content.

There should be no editorial rewriting, polished summaries, visual templates, or presentation layer until these capabilities are proven.

## Core Architecture

```text
LLM
 |-- search_web(query)
 |      `-- search provider -> normalized result list
 |
 `-- fetch_page(url)
        |-- known news site -> Custom News Site Crawler adapter
        `-- unknown/difficult site -> Crawl4AI fallback
```

The LLM controls the research loop, but every conclusion must remain grounded in fetched material.

## Phase 0: Scope Gate

Do not build yet:

- editorial briefs
- article rewriting
- point-form presentation
- visual templates
- "what changed" sections
- polished user-facing prose

The only output at this stage is a structured research packet containing queries, search results, fetched documents, excerpts, metadata, provenance, and failures.

## Phase 1: Build the Search Hand

Create a controlled `search_web` tool that can:

- accept a research question
- generate and refine queries
- search one or more configured providers
- return normalized results
- preserve title, URL, publisher, date, snippet, and ranking
- remove duplicate URLs
- record the exact query that produced each result

The search hand is responsible for discovery only. It is not a source of final facts until a result has been fetched and inspected.

Example result shape:

```json
{
  "query": "2023 Malaysia general election results",
  "results": [
    {
      "title": "...",
      "url": "...",
      "publisher": "...",
      "publishedAt": "...",
      "snippet": "...",
      "query": "2023 Malaysia general election results"
    }
  ]
}
```

## Phase 2: Build the Fetch Hand with Source Priority

The repository already has a per-news-site crawler. This is the preferred fetcher whenever the requested URL belongs to a site with a maintained adapter.

### 2.1 Known-site path: Custom News Site Crawler

When the LLM wants information from a listed site:

1. Detect the matching news-site adapter.
2. Invoke the existing custom crawler.
3. Reuse its site-specific navigation, selectors, date rules, and article-body extraction.
4. Return the crawler's normalized article JSON plus provenance showing which adapter ran.

The custom crawler should be treated as the authoritative path for supported sites because it already contains site-specific knowledge and is more reliable than generic extraction.

Keep shared crawl behavior in the existing core modules, including robots handling and crawl policy. Do not duplicate those rules inside the editorial module.

### 2.2 Fallback path: Crawl4AI

Use [Crawl4AI](https://github.com/unclecode/crawl4AI) when:

- the URL belongs to a site without a maintained adapter
- the custom adapter cannot extract the requested page
- the page requires browser rendering or JavaScript execution
- the research task needs controlled link discovery outside the adapter set

Crawl4AI is useful for:

- JavaScript-heavy pages
- browser-rendered content
- article extraction
- Markdown and HTML cleanup
- metadata capture
- link discovery
- asynchronous crawling

It is not a search engine, so it complements the search hand rather than replacing it.

### 2.3 Fetch routing contract

Expose one LLM-facing tool, such as `fetch_page(url)`, while keeping the routing internal:

```text
fetch_page(url)
  -> supported site -> Custom News Site Crawler
  -> unsupported site -> Crawl4AI
  -> adapter failure -> Crawl4AI, with fallback recorded
```

Every response must state which path was used: `custom-site-crawler` or `crawl4ai`.

Routing priority:

1. If the domain has a maintained adapter, use the Custom News Site Crawler.
2. If the domain has no adapter, use Crawl4AI extraction and cleanup.
3. If a supported-site adapter fails for an individual page, use Crawl4AI as an explicitly recorded fallback.
4. Stop immediately on `403` or `429`; never escalate around the block.

Regardless of the fetch path, the fetch hand must return:

- final URL
- status code
- page title
- publication date
- author when available
- cleaned article text
- relevant excerpts
- extraction quality score
- failure reason
- raw source metadata
- fetcher used
- adapter name when applicable

Initially use deterministic extraction for both paths. Do not enable LLM-based extraction inside Crawl4AI because that would mix crawling and editorial intelligence before the fetch layer is benchmarked.

## Phase 3: Research Session Orchestration

Create a research session where the LLM can:

1. Form a query.
2. Search for candidate sources.
3. Select promising URLs.
4. Fetch and inspect those URLs.
5. Identify missing information.
6. Search again with a refined query.
7. Stop when evidence is sufficient or the budget is exhausted.

Track every session event:

- tool call
- query
- URL visited
- document fetched
- duplicate URL
- failed request
- elapsed time
- request count
- source provenance

## Phase 4: Evidence Ledger

Before editorial logic, create a traceable evidence ledger.

```json
{
  "statement": "...",
  "excerpt": "...",
  "sourceUrl": "...",
  "sourceTitle": "...",
  "publisher": "...",
  "publishedAt": "...",
  "retrievedAt": "...",
  "evidenceType": "direct|context|comparison",
  "confidence": "high|medium|low"
}
```

This is research infrastructure, not editorial output. Every evidence item must remain connected to its source document and retrieval event.

## Phase 5: Benchmark the Two Hands

Create fixtures for both custom-adapter and fallback paths:

- breaking news
- historical comparisons
- election and government data
- conflicting reports
- JavaScript-rendered pages
- duplicate articles
- unavailable pages
- poorly structured pages
- supported news sites where the custom crawler must win over generic extraction
- adapter failures that should fall back to Crawl4AI

Measure:

- search relevance
- fetch success rate
- extraction quality
- metadata completeness
- duplicate detection
- provenance completeness
- time and request cost
- correct handling of `403` and `429`
- correct fetcher routing for supported and unsupported domains

## Editorial Readiness Gate

Do not start editorial development until the research layer can consistently:

- find multiple relevant sources
- fetch source content successfully
- preserve source traceability
- distinguish snippets from fetched evidence
- identify weak or failed sources
- avoid duplicate material
- stop safely on blocked requests
- return predictable JSON

Suggested initial thresholds:

- at least 90% successful fetches on the benchmark set
- at least 95% of evidence items linked to source URLs
- no silent handling of `403` or `429`
- deterministic replay of completed sessions
- explicit failure output when evidence is insufficient
- supported sites use the custom crawler by default
- fallback usage is explicit and measurable

Only after this gate should the project add claim extraction, contradiction analysis, confidence synthesis, and editorial composition.

## Isolation and Repository Fit

Keep this work inside `editorial-pipeline` and consume crawler output or shared crawl helpers through a narrow interface.

Do not add a database, API server, queue, microservices, fingerprint randomization, IP rotation, or paywall bypass as part of this phase.

If the current repository remains JavaScript-based, invoke Crawl4AI through an isolated Python CLI or worker from the research module rather than mixing Python dependencies into the existing crawler core. The existing custom news-site crawler remains the first-choice implementation for supported domains.

## First Deliverable

The first usable product is an LLM-operated web research bench with two reliable hands:

- `search_web(query)` for discovery
- `fetch_page(url)` routed first to the Custom News Site Crawler and then to Crawl4AI when needed

It should produce a reproducible research packet, not an article.
