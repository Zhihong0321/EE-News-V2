# News Fetcher SOP

This SOP covers adding news sites and maintaining existing site adapters. It is written for the current local Node.js monolith.

## 1. Operating Rules

- Run one site at a time during development.
- Keep requests sequential within a site.
- Keep the shared five-second page delay unless the site owner explicitly permits another rate.
- Never randomize fingerprints, rotate IPs, bypass CAPTCHAs, bypass paywalls, or continue after a `403` or `429`.
- Read and respect the site's `robots.txt` and terms.
- Store only the content that the unauthenticated page visibly exposes and that you are permitted to collect.
- Keep site-specific behavior inside that site's adapter. Do not put selectors into the shared runner.

## 2. Add A New Site

### 2.1 Inspect The Site

Record the following before editing code:

- Canonical domain and latest-news entry URL
- Robots.txt URL and relevant rules
- RSS or Atom feed URLs, if advertised and permitted
- Whether the latest page is server-rendered or JavaScript-rendered
- Article URL pattern
- Article title, date, author, section, description, and body locations
- Consent wall, login, paywall, or locked-content behavior
- Site timezone and language

Use a single browser session or read-only HTTP inspection. Do not run broad crawls while inspecting.

### 2.2 Create The Profile

Create these files:

```text
src/sites/<id>.config.js
src/sites/<id>.js
```

The config should contain:

- `id`
- `source`
- `latestUrl`
- `timezone`
- `transport`
- `articleLimit`
- `candidateLimit`
- selectors and ignored-content rules
- optional `feedUrls`

The adapter must implement:

- `today()`
- `collectLinks(page, today)`
- `readArticle(context, link, today)`

Optional fast-path methods:

- `collectLinksHttp(today)` for verified RSS/Atom or HTML discovery
- `readArticleHttp(link, today)` for verified HTTP extraction

Return the normalized article shape already used by the project:

```json
{
  "source": "",
  "title": "",
  "url": "",
  "published_at": "",
  "author": "",
  "section": "",
  "body": "",
  "description": "",
  "fetched_at": ""
}
```

### 2.3 Register And Test

1. Register the adapter in `src/sites/index.js`.
2. Add an npm script only if the site is used frequently.
3. Run syntax checks and tests:

```powershell
npm test
```

4. Run one live fetch:

```powershell
node src/fetcher.js <id>
```

5. Inspect `output/<id>-YYYY-MM-DD.json`.

### 2.4 Definition Of Done

- Three valid same-day articles, or an explicit fewer-than-three result.
- Correct local timezone conversion.
- Full visible article body, preserving paragraph breaks where possible.
- No related-story, advertisement, navigation, or comment text in the body.
- No login/paywall bypass.
- Zero unexplained failures.
- The adapter contract test passes.
- The profile's transport choice is documented by the config.

## 3. Maintain An Existing Site

### 3.1 Detect The Failure Type

Check the JSON output and console message first.

| Symptom | Likely cause |
|---|---|
| `0` candidates | Listing URL, listing selector, feed, or URL pattern changed |
| Candidates found but `0` articles | Article date, title, or body selector changed |
| Empty body | Paywall, consent wall, lazy rendering, or body selector changed |
| HTTP `403` or `429` | Stop the site run; do not retry aggressively |
| Timeout | Site slow, browser flow changed, or network failure |
| Wrong date | Timezone or metadata field changed |
| Body contains navigation/ads | Extraction boundary changed |
| Old JSON remains after failure | Check the failure output and do not ingest it as fresh data |

### 3.2 Reinspect Before Editing

Use the current live page and one article only. Compare:

- HTTP status and redirects
- robots.txt rules and content signals
- Listing link count and URLs
- Article title and publication metadata
- Body container and paragraph boundaries
- Consent, login, or locked-content state

Do not immediately replace every selector with broad selectors. Prefer the smallest stable selector that identifies the intended content.

### 3.3 Make The Smallest Fix

- Selector change: edit only that site's config.
- Navigation change: edit only that site's adapter.
- Date format change: update that site's date parsing.
- RSS change: update that site's `feedUrls` or feed parsing behavior.
- Generic extraction issue: fix `src/core/readability.js` only if multiple sites share the defect.
- Rate, retry, or concurrency issue: edit `src/config/crawl-policy.js` or `src/config/runtime.js`, not a site selector.

Avoid rewriting a working adapter to match another site's structure.

### 3.4 Validate The Fix

Run:

```powershell
npm test
node src/fetcher.js <id>
```

Verify:

- output date is today in the site's timezone
- `count` matches the requested limit when enough articles exist
- `failures` is empty or explained
- titles and URLs are correct
- bodies are complete and clean
- no blocked response was bypassed

Keep the before/after output for one article when changing extraction logic.

## 4. Blocked Site Procedure

When a site returns `403`, `429`, a challenge page, or a clear bot block:

1. Stop the site run.
2. Preserve the failure JSON and console error.
3. Check `Retry-After`, robots.txt, and site terms.
4. Do not increase concurrency, rotate IPs, spoof fingerprints, or add stealth behavior.
5. Wait according to the site's policy or obtain permission.
6. Re-test manually with one request only.
7. If access remains blocked, mark the adapter unavailable and continue with other permitted sites.

A slower request schedule does not make prohibited collection permitted.

## 5. Release And Handoff Checklist

Before merging adapter changes:

- `npm test` passes.
- The adapter is registered and has a clear config.
- One live fetch has been verified.
- The output file was inspected manually.
- Robots and terms were checked.
- Any site-specific caveat is recorded in the config or `docs/`.
- No unrelated site adapter was changed.
- The next maintainer can reproduce the run with `node src/fetcher.js <id>`.

When handing work to another LLM or engineer, report the site id, last successful run, failure symptom, changed selectors, and validation result.
