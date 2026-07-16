# Architecture

This project is intentionally a local monolith. One Node.js process runs one or more site adapters and writes JSON files. There is no database, API server, queue, or service boundary yet.

## Boundaries

- `src/fetcher.js`: command-line entry point only.
- `src/core/runner.js`: shared Playwright lifecycle, retries, pacing, output, and failure handling.
- `src/core/robots.js`: generic robots.txt and content-signal checks.
- `src/core/http.js`: bounded HTTP-first text fetching using Node's built-in fetch.
- `src/core/feed.js`: optional RSS/Atom discovery.
- `src/core/readability.js`: generic article extraction fallback.
- `src/config/crawl-policy.js`: shared crawl policy. This is not an evasion layer.
- `src/config/runtime.js`: machine-capacity settings such as maximum site concurrency.
- `src/sites/<site>.config.js`: site URL, selectors, limits, and site-specific rules.
- `src/sites/<site>.js`: site-specific navigation and extraction behavior.
- `src/sites/index.js`: explicit adapter registry and contract validation.
- `test/`: fast local contract tests. Live site tests remain manual because they make network requests.

## Current contract

Every adapter must expose:

- `id`, `source`, `latestUrl`, `timezone`
- positive `articleLimit` and `candidateLimit`
- `today()`
- `collectLinks(page, today)`
- `readArticle(context, link, today)`

The runner is the only place that should own shared crawling behavior. A site adapter owns selectors, navigation, dates, and article-body decisions.

## Scale path

The runner supports a shared-browser `runSites()` path with bounded concurrency. When more sites are added, keep one process and one browser manager, schedule site jobs behind the runtime limit, and keep each site's requests sequential and governed by the shared policy. Do not add Redis, Celery, RQ, or another service until a measured workload requires it.

Transport order is opt-in per adapter: RSS/Atom discovery and HTTP extraction may be used where verified; Playwright remains the fallback for JS-heavy or consent-wall pages. A `403` or `429` is a stop signal, never a trigger for browser escalation.

The project stays Node-only. Node 24's built-in fetch replaces the need for a Python `httpx` sidecar, `rss-parser` replaces `feedparser`, and `@mozilla/readability` plus `jsdom` provides the generic extraction layer. A Python `trafilatura` process is intentionally deferred until measured extraction failures justify a second runtime.
