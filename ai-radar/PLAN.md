# AI-RADAR — Plan

Realtime detection of AI industry news: model launches, research drops, funding,
policy, and product releases — from the source, before the press writes it up.

A sibling subsystem to the news-fetcher monolith. It reuses that project's
transport and LLM layers; it does not fork them.

Status: **Phases 1 and 3 built and running** (collection, five channel handlers,
relevance/clustering/scoring, daily report card). Phase 2 (Postgres via Hub) and
Phases 4–6 remain. See [README.md](README.md) to run it.

Every source URL in this document was live-probed on 2026-07-31. Verified means:
fetched, HTTP 200, correct content type.

First live run: 31 sources polled, 0 failures, 143 items collected, 64 filtered
as off-topic, 79 reported.

---

## 1. Locked decisions

| Decision | Choice |
|---|---|
| **Latency** | Tiered polling. Hot sources every 2–5 min, warm 15 min, cold hourly. Conditional GET so unchanged feeds cost ~200 bytes. |
| **Storage** | New `radar_*` tables in the existing Postgres, written through the existing Hub API. No new infrastructure. |
| **Scope v1** | ~20 entities, verified channels only. A source is not added until it has been probed and proven. |
| **X/Twitter** | Public syndication endpoint for content; opportunistic Nitter for discovery. No account, no cookies. See §5. |

---

## 2. Why this is not just another site adapter

The news-fetcher model is one hand-written JS adapter per site
(`src/sites/<site>.js` + `.config.js`). That is correct for 20 newspapers with
messy bespoke HTML. It is wrong here:

- AI-RADAR watches ~20 entities across ~60 channels, and the channel list churns
  weekly as labs launch and retire blogs.
- ~80% of those channels are RSS/Atom/JSON APIs with **no per-site logic at all**.
- Writing 60 adapter files for 60 feeds that all parse identically is pure cost.

So AI-RADAR is **registry-driven**: one declarative watchlist file describes
entities and their channels, and a small number of *channel-type handlers*
(`rss`, `sitemap`, `github_releases`, `hf_models`, `json_api`, `html`) execute
them. Adding a lab is a data edit. Only the sites in §4c need real code, and
they reuse the existing Playwright/Readability path.

---

## 3. Who to watch — v1 watchlist (20)

**Frontier labs, West (7)**
OpenAI · Anthropic · Google DeepMind · Meta AI · Microsoft AI · xAI · Mistral

**Frontier labs, China (8)**
DeepSeek · Alibaba Qwen · Moonshot (Kimi) · Zhipu / Z.ai (GLM) · MiniMax ·
ByteDance Seed (Doubao) · Baidu ERNIE · Shanghai AI Lab (InternLM)

**Infra & platform (5)**
Nvidia · Hugging Face · AWS AI · Apple ML · Perplexity

Deferred to v2: Tencent Hunyuan, StepFun, 01.AI, iFlytek, Ant Ling, Cohere,
Runway, ElevenLabs, Groq, Cerebras, Naver, LG, Sakana, AI21, TII Falcon.

---

## 4. Where to watch — probed 2026-07-31

### 4a. Verified working — build on these

| Entity | Channel | URL | Type |
|---|---|---|---|
| OpenAI | Newsroom RSS | `openai.com/news/rss.xml` | rss |
| Google DeepMind | Blog RSS | `deepmind.google/blog/rss.xml` | rss |
| Google AI | Blog RSS | `blog.google/technology/ai/rss/` | rss |
| Meta | Engineering RSS | `engineering.fb.com/feed/` | rss |
| Nvidia | Blog RSS | `blogs.nvidia.com/feed/` | rss |
| AWS | ML Blog RSS | `aws.amazon.com/blogs/machine-learning/feed/` | rss |
| Apple | ML Research RSS | `machinelearning.apple.com/rss.xml` | rss |
| Hugging Face | Blog RSS | `huggingface.co/blog/feed.xml` | rss |
| Alibaba Qwen | Blog Atom | `qwenlm.github.io/blog/index.xml` | rss |
| DeepSeek | News sitemap | `api-docs.deepseek.com/sitemap.xml` → `/news/` | sitemap |
| DeepSeek | GitHub releases | `github.com/deepseek-ai/DeepSeek-V3/releases.atom` | github_releases |
| Qwen | GitHub releases | `github.com/QwenLM/Qwen3/releases.atom` | github_releases |
| Moonshot | GitHub releases | `github.com/MoonshotAI/Kimi-K2/releases.atom` | github_releases |
| Zhipu / Z.ai | GitHub releases | `github.com/zai-org/GLM-4.5/releases.atom` | github_releases |
| MiniMax | GitHub releases | `github.com/MiniMax-AI/MiniMax-M2/releases.atom` | github_releases |
| InternLM | GitHub releases | `github.com/InternLM/InternLM/releases.atom` | github_releases |
| *any lab* | HF model uploads | `huggingface.co/api/models?author=<org>&sort=createdAt` | hf_models |
| Hacker News | Algolia search API | `hn.algolia.com/api/v1/search_by_date` | json_api |
| Reddit | r/LocalLLaMA Atom | `reddit.com/r/LocalLLaMA/new/.rss` | rss |
| Techmeme | RSS | `techmeme.com/feed.xml` | rss |
| TechCrunch AI | RSS | `techcrunch.com/category/artificial-intelligence/feed/` | rss |
| QbitAI 量子位 | RSS | `qbitai.com/feed` | rss |
| AI News | RSS | `artificialintelligence-news.com/feed/` | rss |
| arXiv | Atom API | `export.arxiv.org/api/query?search_query=cat:cs.CL` | json_api |

AI News is worth calling out: its feed ships `content:encoded`, meaning the
**full article body arrives inside the feed**. No second fetch, no Readability
pass, no robots concern. That is the cheapest possible channel.

**The most valuable rows in that table are `github_releases` and `hf_models`.**
For Chinese open-weight labs, the release tag and the Hugging Face upload land
*hours* before any blog post or press coverage. That is the edge this system
has, and it costs nothing.

### Why both GitHub *and* Hugging Face, never just one

`github_releases` feeds are pinned to a **single repo**. `DeepSeek-V3/releases.atom`
will never fire for a new `DeepSeek-V4` repo — and a new frontier model is
exactly the event we exist to catch.

The obvious fix does not work: **GitHub's org-level activity feeds are empty.**
`github.com/<org>.atom` returns valid Atom with zero `<entry>` elements
(verified on `deepseek-ai`, `QwenLM`, `MoonshotAI`, `zai-org`).

So the catch-all is the **Hugging Face org API**, which sorts *all* of an org's
models by `createdAt` and therefore surfaces repos that did not exist yesterday:

```
https://huggingface.co/api/models?author=deepseek-ai&sort=createdAt&direction=-1
```

Rule: every open-weight lab carries an `hf_models` channel as its safety net,
with `github_releases` as the richer-detail supplement. Dropping either one
leaves a hole.

### 4b. No RSS — but solved by `sitemap.xml`, not by scraping

**A site without RSS usually still publishes a sitemap.** That is a structured,
declared-for-crawlers list of every URL, frequently with `<lastmod>`
timestamps. Polling it and diffing against known URLs detects new articles with
no CSS selectors, no Playwright, and nothing that breaks on a redesign — then
the existing `readability.js` extracts each article body.

Probed 2026-07-31:

| Entity | Sitemap | URLs | `lastmod` | news/blog URLs | Verdict |
|---|---|---|---|---|---|
| Anthropic | `anthropic.com/sitemap.xml` | 508 | ✅ all 508 | 252 | **Solved, HTTP only** |
| Mistral | `mistral.ai/sitemap-0.xml` | 459 | ❌ none | 237 | **Solved**, URL-diff only |
| ByteDance Seed | `seed.bytedance.com/sitemap.xml` | 31 | ✅ all 31 | 10 | **Solved, HTTP only** |

ByteDance is the interesting case: its blog page is client-rendered and yields
zero links in raw HTML, yet its sitemap is clean, static XML. Sitemap polling
beats browser automation on a page that specifically defeats HTML parsing.

`robots.txt` on Anthropic, Mistral and ByteDance is `Allow: /` with the sitemap
declared. Reading it is what the file is published for.

Meta AI's `ai.meta.com/blog/rss/` → 404; `engineering.fb.com/feed/` is the
working substitute and is already in 4a.

### 4c. Genuinely need the fetcher path — or dropping

| Entity | Finding | Action |
|---|---|---|
| MiniMax | Sitemap resolves but contains **0 URLs**; news page yields 1 link | Playwright adapter. Low priority — GitHub already covers model drops. |
| Jiqizhixin | No RSS (serves HTML), `sitemap.xml` → **404** | Playwright adapter, or drop — QbitAI may be enough CN coverage. |
| **xAI** | `/news/rss.xml`, `/news`, and `/sitemap.xml` **all 403** (Cloudflare) | **Drop.** Repo policy: 403 is a hard stop, never escalate. Cover via X syndication + aggregators instead. |
| **Baidu Research** | `robots.txt` itself returns an HTML page reading 网站维护中 — **the site is in maintenance** | **Drop from v1.** Recheck later. |
| Microsoft AI | Blog feed → **410 Gone** | Find current URL or drop. |

Note on xAI: its `robots.txt` explicitly allows ClaudeBot and other crawlers,
but the edge returns 403 regardless. The stated policy and the actual behavior
disagree — and the actual behavior is what we honor.

---

## 5. How to watch X/Twitter

Researched the GitHub tooling landscape rather than assuming. Findings:

| Tool | Stars | How it actually authenticates |
|---|---|---|
| `Panniantong/Agent-Reach` | 63k | Requires **your** `TWITTER_AUTH_TOKEN` + `TWITTER_CT0` cookies |
| `public-clis/twitter-cli` | 2.8k | The engine Agent-Reach routes to. Cookie-based. |
| `ythx-101/x-tweet-fetcher` | 920 | Claims "no login" — in reality proxies to **Nitter** instances |
| `d60/twikit` | 4.6k | Cookie / credential login |
| `vladkens/twscrape` | 2.6k | Pool of real X accounts |
| `zedeus/nitter` | 13k | Self-host; needs guest tokens X keeps revoking |

**Every one of them is cookie or account based.** Agent-Reach's own README
warns of it directly — it tells users to use a burner account because
script-driven access risks a ban. It is also shaped as an *interactive* agent
tool (installs skills, MCP servers, asks the agent to run shell commands), which
is a poor fit for an unattended poller firing every 2–5 minutes.

So AI-RADAR will not use any of them in the automated path. Attaching a real X
account to a 24/7 crawler means the account eventually dies, and it contradicts
this repo's standing no-evasion rule in `AGENTS.md`.

### The approach we will use

X publishes an **unauthenticated syndication API** — the infrastructure that
powers embedded tweets on third-party websites. Verified live:

```
GET https://cdn.syndication.twimg.com/tweet-result?id=<tweet_id>&lang=en
→ 200, full JSON: text, created_at, favorite_count, entities, media
```

No account, no cookies, no API key, no ban risk. It is a public endpoint doing
exactly what it was built for.

Its one limit: it resolves **tweets by ID**, it does not list timelines. So the
design splits the problem:

- **Discovery — where tweet IDs come from.** Nitter RSS (`nitter.net` verified
  serving fresh posts today) as best-effort, plus tweet URLs already appearing
  in the HN / Reddit / Techmeme feeds we poll anyway. Both are ID sources only.
- **Hydration — where content comes from.** Always the syndication endpoint.

The value of this split: discovery is allowed to be flaky. If Nitter dies —
and it will — the radar degrades to "we see the tweets that got discussed
elsewhere" rather than breaking. Nothing is a hard dependency, and the
legitimate endpoint does all the real work.

X remains a **secondary** signal in v1. Anything genuinely announced there
reaches HN, Techmeme and Reddit within minutes, and those are free and stable.

---

## 6. Polling schedule

Every request uses conditional GET (`If-None-Match` / `If-Modified-Since`). An
unchanged feed answers `304` in a few hundred bytes, so the hot tier is cheap.

| Tier | Interval | Sources |
|---|---|---|
| **Hot** | 2–5 min | Tier-1 lab feeds, all `github_releases`, HF model uploads, HN API |
| **Warm** | 15 min | Techmeme, Reddit, QbitAI, TechCrunch, HTML-polled lab pages |
| **Cold** | 60 min | arXiv, secondary press, tier-3 entities |

Rules carried over from the parent project, non-negotiable:

- `403`/`429` is a **hard stop** for that source, never a trigger to escalate to
  a browser or retry harder. Back off exponentially, mark the source degraded.
- Respect `robots.txt` via the existing `src/core/robots.js`.
- Per-host serialization; no parallel hammering of one origin.
- A source failing N consecutive polls is auto-quarantined to the cold tier and
  surfaced in a health report rather than silently retrying forever.

---

## 7. Data model

New tables, existing Postgres, written through the Hub API.

```sql
-- Who we watch.
create table if not exists radar_entities (
  id          bigint generated always as identity primary key,
  slug        text not null unique,          -- 'openai', 'deepseek'
  name        text not null,
  category    text not null,                 -- 'frontier' | 'infra' | 'app'
  country     text,                          -- 'US' | 'CN' | ...
  tier        integer not null default 1,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Channels belonging to an entity. Registry rows, not code.
create table if not exists radar_sources (
  id             bigint generated always as identity primary key,
  entity_id      bigint references radar_entities (id) on delete cascade,
  kind           text not null,              -- rss|sitemap|github_releases|hf_models|json_api|html|x_syndication
  url_filter     text,                       -- e.g. '/news/' — which sitemap URLs count as articles
  url            text not null,
  poll_tier      text not null default 'warm',
  etag           text,                       -- conditional GET state
  last_modified  text,
  last_polled_at timestamptz,
  last_ok_at     timestamptz,
  fail_count     integer not null default 0,
  enabled        boolean not null default true,
  unique (entity_id, url)
);

-- One row per raw observed item, pre-clustering.
create table if not exists radar_items (
  id            bigint generated always as identity primary key,
  source_id     bigint references radar_sources (id) on delete set null,
  entity_id     bigint references radar_entities (id) on delete set null,
  external_id   text,                        -- tweet id, release tag, guid
  url           text not null unique,
  title         text not null,
  body          text,
  summary       text,                        -- LLM distilled, English
  signal_type   text,                        -- model_release|research|funding|policy|product
  published_at  timestamptz,
  observed_at   timestamptz not null default now(),
  event_id      bigint,                      -- FK set by clustering
  raw           jsonb
);

create index if not exists radar_items_observed_idx  on radar_items (observed_at desc);
create index if not exists radar_items_entity_idx    on radar_items (entity_id, published_at desc);

-- Clustered story: many items, one real-world event.
create table if not exists radar_events (
  id            bigint generated always as identity primary key,
  headline      text not null,
  summary       text,
  entity_id     bigint references radar_entities (id) on delete set null,
  signal_type   text,
  impact_score  integer,                     -- 0-100
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  item_count    integer not null default 1
);

create index if not exists radar_events_score_idx on radar_events (impact_score desc, first_seen_at desc);
```

`radar_items.url` unique is the cheap first-line dedupe. Semantic clustering
into `radar_events` is a second pass (§8).

---

## 8. Pipeline

```
poll → normalize → dedupe → cluster → score → store → surface
```

1. **Poll** — channel handler fetches with conditional GET. `304` → done, zero cost.
2. **Normalize** — every channel type maps into a common item shape
   (`url, title, body, published_at, external_id`).
3. **Dedupe** — exact URL match, then the existing `dedup_title` technique from
   `src/core/dedupe.js`: distill to a short English gist and compare within a
   recent window.
4. **Cluster** — group items describing one real event. 20 outlets covering a
   launch become one `radar_event` with 20 citations. Reuses the LLM control
   plane (`src/core/llm-registry.js`), so model routing stays factory-managed.
5. **Score** — impact 0–100 from: entity tier, signal type, source count,
   velocity (how fast citations accumulate), and whether it originated
   first-party. A DeepSeek release tag seen before any press should score high.
6. **Store** — write through the Hub API, same as the news pipeline.
7. **Surface** — v1 is a JSON feed plus a page in the existing `src/server.js`
   UI. No new service.

---

## 9. Reuse map

| Need | Existing module |
|---|---|
| RSS/Atom parsing | `src/core/feed.js` |
| Bounded HTTP fetch | `src/core/http.js` |
| robots.txt checks | `src/core/robots.js` |
| Article body extraction | `src/core/readability.js` |
| Playwright fallback | `src/core/runner.js` |
| LLM routing / fallback chain | `src/core/llm-registry.js` |
| Distillation | `src/core/distill.js` |
| Duplicate detection | `src/core/dedupe.js` |
| Retry/backoff state | `src/db/pipeline-status.js` |
| Remote writes | `src/db/hub-client.js` |

New code is confined to: the watchlist registry, the channel handlers, the
scheduler, and the clustering/scoring pass.

---

## 10. Build phases

**Phase 1 — collection skeleton — DONE**
Registry + conditional-GET poller + per-host serialization + seen-URL baselines.
Output to `output/ai-radar/`.

**Phase 3 — channels — DONE** (pulled ahead of storage; proving the sources
mattered more than persisting them)
`rss`, `sitemap`, `github_releases`, `hf_models`, `json_api`. Only MiniMax and
Jiqizhixin still need Playwright, and both are optional.

Also built ahead of plan, because the first live run was unusable without them:
a relevance gate (aggregators carry far more than AI), signal classification,
title-signature clustering, and transparent scoring. PLAN §8 assumed the LLM
would do the clustering; a deterministic pass turned out to be enough for v1 and
costs nothing per run.

**Phase 2 — storage — NEXT**
Migration for the `radar_*` tables, Hub write-through, dedupe on URL. The daily
JSON is currently the store; the schema in §7 is unchanged and ready.

**Phase 4 — X**
Syndication hydration + Nitter/aggregator discovery, strictly non-blocking.

**Phase 5 — intelligence**
Clustering, impact scoring, LLM summaries.

**Phase 6 — surface**
Feed endpoint and a page in the existing UI. Source-health report.

Phases 1–2 are the ones that produce something useful; 5–6 make it pleasant.

---

## 10a. Known coverage gaps

**Moonshot (Kimi) and Zhipu (GLM) have no discoverable news channel.**

Both are fully covered for *model releases* via GitHub + Hugging Face. Neither
has a findable official announcement feed:

- Moonshot — `moonshot.cn/news`, `platform.moonshot.cn/blog` and
  `moonshotai.github.io` yield nothing usable; the platform sitemap has 0 URLs.
- Zhipu — `z.ai/blog` 404s, and `z.ai/sitemap.xml` contains only product and
  account pages. `zhipuai.cn/news` is server-rendered but the host timed out
  repeatedly from outside China.

Practical effect: if either announces funding, a partnership or a policy
position *without* shipping weights, we learn it from QbitAI or Hacker News
rather than first-party. Acceptable for v1; revisit if it bites.

Related: **China-hosted origins are slow and flaky from outside CN**
(`zhipuai.cn` timed out at 20–25s). They need generous timeouts and tolerant
failure handling, and belong in the warm/cold tier — never hot.

## 10b. Excluded sources

Sites whose operators have declined automated collection. Recorded here so
nobody re-proposes them in three months.

**AI工具集 — `ai-bot.cn/daily-ai-news/`**

Its `robots.txt` enumerates and blocks the entire AI/aggregator crawler class
with `Disallow: /`: `anthropic-ai`, `ClaudeBot`, `Claude-Web`, `GPTBot`,
`ChatGPT-User`, `CCBot`, `cohere-ai`, `Google-Extended`, `Bytespider`,
`Diffbot`, `Scrapy`, `news-please`, `NewsNow`, `omgili` and more. Its WordPress
RSS is deliberately switched off — `/feed/` returns `Feed关闭`.

`User-agent: *` does leave the content paths open, so a generically-named
crawler would pass the letter of the file. But that list names this exact class
of bot, and picking a user-agent to slip past it is evasion — the thing
`AGENTS.md` rules out. The parent project already holds this line for The Star,
where scraping requires prior permission.

Excluded unless the operator grants permission. The loss is small: it is an
aggregator, so the stories it carries originate in sources we already poll, and
our GitHub/HF signals fire earlier than any aggregator can.

## 11. Non-goals

- No X account, cookie jar, or credential-based social scraping.
- No paid API tier in v1. Revisit only against measured coverage gaps.
- No new service, queue, or database. This lives in the existing process and
  the existing Postgres.
- No paywall bypass, fingerprint randomization, or IP rotation — same standing
  rule as the parent project.
- Not a general news reader. If an item is not about an AI company, model,
  research result, or policy, it does not belong here.

---

## 12. Open questions

- **Microsoft AI** blog feed returns 410; find the current URL or drop the entity.
- **Jiqizhixin** has neither RSS nor sitemap — worth a Playwright adapter, or is
  QbitAI enough Chinese-language coverage for v1?
- **Mistral's sitemap has no `lastmod`**, so new-article detection is pure URL
  diffing. That needs a seeded baseline on first run, or the first poll reports
  237 "new" articles.
- **Mistral's sitemap is multilingual** (`/fr/news/`, etc.). Filter to one locale
  or the same story arrives five times.
- **HF model uploads** are noisy (quantizations, forks, community re-uploads).
  Needs a filter — probably first-party org only, plus a minimum size threshold.
- **arXiv** is a firehose. Filter by author affiliation, or skip until v2?
- **Sitemaps are large** (Anthropic's is 66 KB). Conditional GET makes repeat
  polls free, but if a host ignores `If-None-Match` this belongs in the warm
  tier, not hot.
