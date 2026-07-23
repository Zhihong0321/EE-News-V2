# Fix the Stupid Pipeline

A prioritized, practical fix plan for the fetch → RENDERED pipeline.
Scope: `src/core/*`, `src/db/*`, `src/server.js`, `public/*`.

Two hard requirements from the owner sit at the top (P0). Everything else is
ordered by leverage. Each item says **what's wrong**, **what to do**, and
**files to touch**. No code is changed by this document — it's the plan.

---

## Guiding principles (read first)

1. **The scraper must never fail because an AI endpoint is slow or down.**
   Extraction is deterministic and cheap. LLM tagging/distillation is
   best-effort enrichment. They must not sit on the crawl's critical path.
2. **No cruel limits.** Token caps, step caps, and hard article ceilings that
   exist "to be safe" but actually truncate real work must go. Limits should
   protect against runaway cost, never silently ruin a legitimate run.
3. **When something degrades, the dashboard says so — loudly.** Silent failure
   is the enemy. Every external dependency (each LLM key) reports health.

---

## P0-A — Factory dashboard MUST report LLM key health (slow / broken)

**Problem today:** when a distill/tag provider is rate-limited, timing out, or
the key is dead, the article just gets `dedup_title: null` / empty tags and the
run limps on. Nothing on the factory page tells you a key is the problem. You
find out by noticing bad data days later.

**What to build:**

1. **Per-provider health tracking.** Add a small in-memory health registry
   (new file `src/core/llm-health.js`) that every LLM call reports into:
   - provider name (`minimax`, `mimo-0730`, `mimo-0726`, `anthropic`, `tagger`)
   - last outcome: `ok` | `slow` | `auth_error` | `rate_limited` | `timeout` | `down`
   - last latency (ms), last error message, last success timestamp,
     consecutive-failure count, rolling success rate (last N calls).
   - Classify by HTTP status: `401/403` → `auth_error` (KEY BROKEN),
     `429` → `rate_limited`, abort/timeout → `timeout`, latency over a
     threshold (e.g. > 10s) → `slow`, network error → `down`.

2. **Expose it.** Extend the existing status endpoint
   [`/api/factory/status`](src/server.js#L328) with an `llm` block, e.g.
   ```json
   "llm": {
     "generatedAt": "...",
     "providers": [
       { "name": "minimax", "state": "auth_error", "lastError": "HTTP 401 invalid api key",
         "lastLatencyMs": null, "successRate": 0.0, "consecutiveFailures": 12,
         "lastSuccessAt": "2026-07-20T..." }
     ],
     "overall": "degraded"   // ok | degraded | down
   }
   ```
   `overall` = `down` if every provider is failing, `degraded` if any key is in
   a non-ok state, else `ok`.

3. **Show it on the page.** In [`public/factory.html`](public/factory.html) /
   [`public/factory.js`](public/factory.js) add an **"AI Providers"** panel:
   - Green / amber / red dot per provider.
   - Red + "KEY NOT WORKING" for `auth_error` — this is the case you care about
     most (a bad/expired `DISTILL_*_TOKEN` or `ANTHROPIC_AUTH_TOKEN`).
   - Amber + "slow (12.4s)" for latency, "rate-limited" for 429.
   - A top-of-page banner when `overall !== 'ok'`:
     **"⚠ AI enrichment degraded — minimax key returning 401. Tagging/distill
     disabled; articles still being fetched."**

4. **Make the classification honest.** Right now distill throws one merged
   string after trying everything ([distill.js:156](src/core/distill.js#L156)).
   Preserve per-provider status codes so `401` (dead key) is never mislabeled
   as a generic failure.

**Files:** new `src/core/llm-health.js`; `src/core/distill.js`,
`src/core/tagger.js` (report into it); `src/server.js` (`/api/factory/status`);
`public/factory.js`, `public/factory.html`, `public/factory.css`.

---

## P0-B — Kill the cruel/impractical limits

These are the limits that quietly ruin real runs. Remove or fix each.

1. **`max_tokens: 128` on distillation** — [distill.js:109](src/core/distill.js#L109).
   The configured MiMo models emit a `thinking` block that consumes this budget,
   leaving the actual answer empty/truncated → "empty gist" → whole chain fails.
   The response parser already strips `thinking` blocks
   ([distill.js:121-125](src/core/distill.js#L121)) — the problem is purely that
   the cap is shared with reasoning the request never asked to limit (no
   `thinking` parameter is sent at all).
   **Fix:** raise to a realistic budget (e.g. `512`+), and if the provider
   supports disabling/limiting reasoning, request only the final text. A 30-word
   gist should never be starved by a 128-token cap shared with hidden reasoning.

2. **`max_tokens: 256` on tagging** — [tagger.js:86](src/core/tagger.js#L86).
   Same reasoning-block risk. Raise to a safe value (e.g. `512`).

3. **Unbounded backfill** — [server.js:294](src/server.js#L294) sets
   `articleLimit: since ? Infinity : undefined` — i.e. every `since`-backfill
   runs uncapped. This is the *opposite* problem: no cap at all, so a
   backfill can extract thousands of articles. **Fix:** replace `Infinity` with a
   sane, configurable backfill ceiling (e.g. `BACKFILL_MAX` env, default a few
   hundred) — big enough for real multi-day pulls, bounded enough to not run
   forever. Not cruel, just not infinite.

4. **`body`-required drop** — [runner.js:185](src/core/runner.js#L185).
   An article with a title but empty extracted body is thrown away as a
   "failure." For short/paywalled/photo pieces that's wrong. **Fix:** keep the
   article if it has a title + URL + (body OR description); only treat truly
   empty extractions as failures.

5. **Overshoot waste + vanishing candidates** — [runner.js:167](src/core/runner.js#L167).
   Workers check `validCount >= effectiveLimit` before incrementing, so with
   concurrency N you extract up to N-1 extra articles past the limit — each
   paying LLM cost. The mirror problem: a candidate whose index was already
   claimed when the limit (or a `stopError`) hits during its `pageDelayMs` sleep
   is abandoned at the post-sleep check ([runner.js:173](src/core/runner.js#L173))
   with **no `failureList` entry** — it just vanishes from the output.
   **Fix:** atomically claim a slot before extracting, record abandoned
   candidates as `skipped`, or just accept the small overshoot but skip
   enrichment once the limit is hit. (Low priority once enrichment leaves the
   hot path — see P1.)

6. **Retry-on-non-retryable** — the only classification that exists is an
   inverted stop-list, `stopStatuses: [403, 429]`
   ([crawl-policy.js:13](src/config/crawl-policy.js#L13)), consulted by all four
   retry loops in runner.js (126, 143, 280, 298). Anything *not* on that list —
   `400`, `401`, `422`, malformed response — is retried on every attempt, and in
   the distill chain across every provider too. **Fix:** invert it: retry only
   transient classes (timeout, 429, 5xx, network); fail fast on 4xx client
   errors. (403 staying a hard stop is correct.)

7. **DB persistence failure is a `console.warn`** — [runner.js:238](src/core/runner.js#L238).
   If `persistArticles` throws, the articles are written to disk but never reach
   the database — which means no `article_pipeline_status` rows are created and
   the enrichment pass (P1) will never see them. Silent loss at the pipeline's
   front door, disguised as a log line. **Fix:** treat DB persist as a real
   pipeline stage: surface the failure on the factory page (P0-A style) and make
   it retryable, instead of warn-and-forget.

**Files:** `src/core/distill.js`, `src/core/tagger.js`, `src/server.js`,
`src/core/runner.js`, `src/config/*`.

---

## P1 — Get LLM calls OFF the crawl's critical path (highest leverage)

**Problem:** each worker blocks on `generateTags` + `generateDigest`
([runner.js:188](src/core/runner.js#L188), [runner.js:194](src/core/runner.js#L194)),
30s timeout each. The crawl's success is chained to AI uptime — the root cause
of most fragility.

**The good news:** the async machinery already exists — and more of it than
this plan first assumed. `article_pipeline_status` is in place,
[retry-pipeline.js](src/core/retry-pipeline.js) is already a **generic**
stage-retry engine (`retryFailedStages({ stage })`), and
[retry-distill.js](src/core/retry-distill.js) is just a thin wrapper that
hardcodes `stage: 'distill'`. The fetch stage just needs to stop doing
enrichment inline, and the engine needs two small extensions.

**What to do:**

1. **Fetch stage = extract + persist only.** On extraction, upsert the article
   with its schema defaults (`tags` is `text[] not null default '{}'`, so an
   empty array — not null; `dedup_title` stays null) and record pipeline stages
   `distill: pending`, `tag: pending`. Do **not** call the LLM in the worker.
2. **Enrichment stage = separate pass.** The engine exists; extend it:
   - `getRetryableWork` currently selects **only** `status = 'failed'`
     ([pipeline-status.js:49](src/db/pipeline-status.js#L49)) — widen it to
     `status in ('pending', 'failed')` so freshly-fetched articles are picked up,
     not just previously-failed ones.
   - Add a `tag` stage runner beside the distill one (today only `distill` is
     wired; tags are never retried anywhere).
   - Backoff already works ([pipeline-status.js:36](src/db/pipeline-status.js#L36),
     linear 10 min/attempt capped at 6 h) — reuse as-is.
   - Run it via `npm run enrich` and/or a loop after each fetch. The dashboard's
     existing `POST /api/factory/retry` endpoint can trigger the same pass.
3. **Dashboard already shows pipeline stage counts** (`getPipelineDashboard`,
   and `public/factory.js` already renders pending/failed/done/skipped totals) —
   just make sure the new `tag` stage and `pending` backlog show up there.

**Payoff:** crawls succeed even with every AI key dead; enrichment catches up
later; the P0-A health panel tells you when to care.

**Files:** `src/core/runner.js` (strip inline enrichment),
`src/core/retry-distill.js` → generalize, new `src/enrich-cli.js` or reuse,
`src/db/pipeline-status.js` (query `pending`), `public/factory.js`.

---

## P1-B — The RENDERED path silently hides articles (the scan's blind spot)

The pipeline's public endpoint is `/api/news` + `/rendered/:name`, fed by
`listPublishedArticles()` in [server.js](src/server.js). This is where "article
exists but isn't on the site, and nobody knows why" happens — pure guiding
principle #3 territory, and none of it is hard to fix.

1. **The mtime gate** — [server.js:227](src/server.js#L227):
   `renderStat.mtimeMs < packetStat.mtimeMs` hides an article whenever its
   enrichment packet is newer than its rendered HTML. Re-run the enricher, touch
   a packet, rsync the directory — articles vanish from the site with zero log
   output until a re-render happens. **Fix:** log every article skipped here
   (once per listing, with counts), and surface a "hidden as stale" count on the
   factory page. Longer-term, publish from an explicit manifest written by the
   renderer instead of inferring freshness from filesystem mtimes.

2. **Whole-packet swallow** — [server.js:249-251](src/server.js#L249): the entire
   per-packet loop is wrapped in `catch { /* stay unpublished */ }`. A corrupt
   JSON packet, a stat error, anything — the packet's articles all disappear
   silently. **Fix:** log the packet name + error. One line. That's the fix.

3. **Convention coupling that fails silently.** Publishing requires
   `article.status === 'enriched'` ([server.js:213](src/server.js#L213)) and a
   render file named exactly `infographic_<base><suffix>.dc.html` where the
   suffix is `-N` only when the packet has >1 enriched article
   ([server.js:217-219](src/server.js#L217)). Any drift in either convention —
   a renamed status, a renderer that always suffixes — blanks the whole site
   with no error. **Fix:** same as above — count and log the skips; assert the
   convention in a test that runs the real renderer output through
   `listPublishedArticles`.

4. **`/api/news` re-reads and re-stats the whole editorial directory on every
   request** ([server.js:445-447](src/server.js#L445)), unauthenticated and
   uncached. **Fix:** cache the listing for a few seconds (or invalidate on a
   directory watcher). Trivial, and it removes a free DoS lever.

5. **Date ordering by string compare** — [server.js:254-255](src/server.js#L254)
   sorts on `localeCompare` of `published_at`. Fine for pure ISO strings, wrong
   the moment one legacy/mixed format sneaks in. **Fix:** parse to a timestamp
   once, sort numerically.

**Files:** `src/server.js` (`listPublishedArticles`, `/api/news`),
`public/factory.js` (surface the skip/stale counts from P0-A's status payload),
one new test.

---

## P2 — Stop paying for a dedup feature the fetch pipeline doesn't use

`dedup_title` is generated for every article at fetch time but `findDuplicate`
runs only in the separate editorial pipeline
([enrich-news.js:54](editorial-pipeline/src/enrich-news.js#L54)).

**Decision:** once P1 lands this is automatically fixed — distillation becomes
part of the async enrichment stage, so fetch no longer pays for it. Just make
sure `dedup_title` is produced by the enrichment pass, not the crawl. No
separate work if P1 is done.

---

## P3 — Collapse the copy-paste (AI's favorite mistake)

Not urgent, but this is why the codebase feels brittle and huge.

1. **One shared LLM client.** [tagger.js](src/core/tagger.js) and
   [distill.js](src/core/distill.js) duplicate the entire `/v1/messages` call
   (AbortController, headers, content-block parsing, error parsing). Extract
   `src/core/llm-client.js` with `callMessages({ provider, prompt, maxTokens })`
   that: makes the call, classifies the outcome, and reports to `llm-health.js`
   (P0-A). Both distill and tag use it → tagger gets the same fallback chain
   distill has, and health tracking is automatic.

2. **One `withRetry(fn, { retries, isRetryable })` helper.** The retry loop is
   copy-pasted 4× in [runner.js](src/core/runner.js) (126, 143, 280, 298).

3. **Config-driven extraction instead of 12 near-identical adapters.**
   `thestar.js` vs `chinapress.js` differ by ~34 of ~119 lines. Each also
   reimplements metadata/JSON-LD/date extraction inline — duplicating
   [readability.js](src/core/readability.js). Target: one extractor driven by
   the per-site `.config.js` (URL pattern, hostname, selectors, date parser),
   with `generic.js` as the base. This is a bigger refactor — do it last, one
   site at a time, keeping tests green.

**Files:** new `src/core/llm-client.js`; `src/core/tagger.js`,
`src/core/distill.js`, `src/core/runner.js`; long-term `src/sites/*`.

---

## P4 — Overengineering cleanup (low priority)

1. **Two status systems.** File-based `.factory/*.json`
   ([factory-status.js](src/core/factory-status.js)) + DB
   `article_pipeline_status`. Keep the file-based one for live crawl progress
   (works without a DB); keep the DB one for enrichment backlog. Just don't add
   a third — and don't try to merge them.

2. **Status file rewritten on every worker event** — full `structuredClone` +
   atomic rename per phase change ([factory-status.js:65](src/core/factory-status.js#L65)).
   Debounce writes (e.g. coalesce to at most every ~500ms) instead of writing on
   every single event. Disk churn drops massively; the UI polls slower than that
   anyway.

3. **Unauthenticated public crawl trigger** — `POST /api/sites/:id/fetch`
   ([server.js:423](src/server.js#L423)) runs a full fetch with **no auth**;
   the only auth gate covers `/api/factory/*` paths. Anyone who finds the URL
   can hammer your crawlers and churn the output directory that feeds
   `/api/news`. **Fix:** put it behind the factory session like its
   `/api/factory/sites/:id/fetch` twin, or delete it.

4. **Password handling** — [server.js:21](src/server.js#L21) hardcodes
   `'eternalgy2026'` as the default. At minimum: refuse to start (or log a big
   warning) if `FACTORY_PASSWORD` is unset, rather than silently using a public
   default.

---

## Suggested order of work

1. **P0-A** — LLM health panel (you asked for it; also makes everything else
   observable).
2. **P0-B** — remove the cruel limits (fast wins, stops active damage).
3. **P1** — move enrichment off the crawl path (fixes the root fragility; also
   resolves P2 for free).
4. **P1-B** — un-silence the RENDERED path (mostly logging + one cache; cheap,
   and it's the user-visible half of "silent failure is the enemy").
5. **P3.1 + P3.2** — shared LLM client + `withRetry` (small, high clarity gain,
   pairs naturally with P0-A/P1).
6. **P4** — housekeeping.
7. **P3.3** — the big adapter refactor, last, incrementally.

---

## Execution checklist

For the implementing agent. Work top to bottom — the order matters (P0-B.7 and
P0-A land before P1 depends on them). Rules: one phase = one commit; run
`npm test` after every phase and keep it green; tick a box only when the
acceptance check passes; if reality contradicts this plan, stop and report —
don't improvise.

### Phase 1 — P0-A: LLM health panel

- [ ] Create `src/core/llm-health.js`: in-memory registry, `report(provider, outcome, { latencyMs, error, status })` + `snapshot()`; classify `401/403 → auth_error`, `429 → rate_limited`, abort → `timeout`, `>10s → slow`, network → `down`; track last error, last success, consecutive failures, rolling success rate.
- [ ] `src/core/distill.js`: report every provider attempt into the registry, preserving the HTTP status per provider (don't let the merged error string at distill.js:156 eat the 401).
- [ ] `src/core/tagger.js`: report its single provider's outcomes the same way.
- [ ] `src/server.js`: add `llm` block (providers + `overall: ok|degraded|down`) to `GET /api/factory/status`.
- [ ] `public/factory.js` + `factory.html` + `factory.css`: "AI Providers" panel — green/amber/red per provider, "KEY NOT WORKING" on `auth_error`, top banner when `overall !== 'ok'`.
- [ ] **Accept:** with a deliberately bad `DISTILL_MINIMAX_TOKEN`, run one fetch → factory page shows red `auth_error` for minimax within one poll cycle, and the crawl still completes.

### Phase 2 — P0-B: kill the cruel limits

- [ ] `distill.js:109`: `max_tokens: 128` → `512` (and request reduced/final-only reasoning if the provider supports it).
- [ ] `tagger.js:86`: `max_tokens: 256` → `512`.
- [ ] `server.js:294`: replace `Infinity` with `BACKFILL_MAX` env (default ~300), documented in `.env.example`.
- [ ] `runner.js:185`: keep articles with title + URL + (body OR description); only fully-empty extractions go to `failureList`.
- [ ] Retry classification: retry only timeout/429/5xx/network; fail fast on 4xx client errors (keep 403 as hard stop). Applies to all four runner.js loops (126, 143, 280, 298) via `crawl-policy.js`.
- [ ] Overshoot/vanishing candidates (runner.js:167/173): record abandoned candidates as `skipped`; don't enrich past the limit. (OK to defer the atomic-claim part until Phase 3 removes inline enrichment.)
- [ ] DB persist failure (runner.js:238): no longer warn-and-forget — surface it in the run result + factory status, and make it retryable.
- [ ] **Accept:** distill of a long article returns a non-empty gist; a `since` backfill stops at `BACKFILL_MAX`; a forced 401 is NOT retried; a forced DB outage during fetch is visible in the factory status output.

### Phase 3 — P1: enrichment off the crawl path

- [ ] `runner.js`: delete inline `generateTags`/`generateDigest` calls (188/194); on persist, record `distill: pending` + `tag: pending` stage rows (tags default `'{}'`, `dedup_title` null).
- [ ] `pipeline-status.js:49`: `getRetryableWork` selects `status in ('pending','failed')`.
- [ ] Add `tag` stage runner beside distill in `retry-pipeline.js`; expose as `npm run enrich` (and reuse `POST /api/factory/retry`).
- [ ] `public/factory.js`: pending/failed counts include the `tag` stage.
- [ ] Confirm P2 for free: `dedup_title` now produced only by the enrichment pass — no distill call anywhere in the fetch stage.
- [ ] **Accept:** with ALL LLM env tokens unset, a full fetch run succeeds and articles land in the DB with pending stages; then `npm run enrich` (with tokens restored) fills tags + dedup_title and stages go `done`.

### Phase 4 — P1-B: un-silence the RENDERED path

- [ ] `listPublishedArticles`: log (once per listing, with counts) every article skipped by the mtime gate (server.js:227), the `enriched` filter (213), missing render file, and missing required fields (233).
- [ ] Replace the bare `catch {}` at server.js:249-251 with a logged packet name + error.
- [ ] Expose a `hiddenAsStale` / `skipped` count in `/api/factory/status`; show it on the factory page.
- [ ] Cache the `/api/news` listing for a few seconds.
- [ ] Sort by parsed timestamp, not `localeCompare` (server.js:254-255).
- [ ] Add a test: run real renderer-style output through `listPublishedArticles` to pin the `infographic_<base><suffix>.dc.html` naming convention.
- [ ] **Accept:** touch a packet file newer than its render → article disappears from `/api/news` AND a log line + dashboard counter say exactly why.

### Phase 5 — P3.1 + P3.2: dedupe the plumbing

- [ ] Extract `src/core/llm-client.js` (`callMessages({ provider, prompt, maxTokens })`) — calls, classifies, reports to `llm-health.js`; distill AND tagger use it; tagger inherits the full provider fallback chain.
- [ ] Extract one `withRetry(fn, { retries, isRetryable })`; replace the four copy-pasted loops in runner.js.
- [ ] **Accept:** `npm test` green; grep shows no remaining direct `fetch(.../v1/messages` outside `llm-client.js`, and no hand-rolled retry loops in runner.js.

### Phase 6 — P4: housekeeping

- [ ] Debounce `factory-status.js` persists (~500ms coalesce).
- [ ] Auth-gate or delete public `POST /api/sites/:id/fetch` (server.js:423).
- [ ] `FACTORY_PASSWORD` unset → refuse to start (or loud warning); remove the hardcoded default from server.js:21.
- [ ] **Accept:** status file writes drop to ≤2/sec during a crawl; unauthenticated fetch trigger returns 401/404; server without `FACTORY_PASSWORD` behaves as decided.

### Phase 7 — P3.3: adapter refactor (incremental, optional)

- [ ] One site at a time: drive extraction from the `.config.js` + `generic.js`; delete the per-site duplicate metadata/JSON-LD/date code; tests green after EACH site before starting the next.
- [ ] Stop at any point — every migrated site must stand alone.

---

## Explicitly NOT doing (and why)

- **Not** adding embeddings/vector dedup — Jaccard on distilled gists is fine at
  this volume ([dedupe.js:1](src/core/dedupe.js#L1)).
- **Not** merging the two status systems — they serve different needs; merging
  adds risk for no gain.
- **Not** rewriting the site adapters all at once — incremental, test-guarded,
  or not at all.
- **Not** touching the readability.js "avoids a 2nd JSDOM" comment — verified
  accurate: the content fragment is a detached `<div>` in the *same* JSDOM
  window ([readability.js:45-46](src/core/readability.js#L45)); no second JSDOM
  is ever constructed. (An earlier draft of this plan flagged it as misleading —
  it isn't.)
