# AI-RADAR

Collects AI industry news from ~30 verified channels and writes one **AI Daily
Report** card (Markdown + JSON) for the HTML/slide/video stage.

Design rationale and source-by-source probe results live in [PLAN.md](PLAN.md).
The watchlist itself is [watchlist.json](watchlist.json) — adding a lab is a
data edit, not a code change.

## Run it

```bash
npm run radar
```

| Command | What it does |
|---|---|
| `npm run radar` | Poll hot + warm sources, 24h window, write today's report |
| `npm run radar:hot` | Hot sources only — frontier labs, GitHub, HF, Hacker News |
| `npm run radar:daily` | Everything including cold sources (arXiv) |
| `npm run radar:dry` | Collect and print, write nothing |

Flags: `--tier hot|warm|cold`, `--hours N`, `--only <entity-slug>`, `--dry-run`.

```bash
node ai-radar/src/cli.js --only deepseek --hours 72
```

## Output

```
output/ai-radar/ai-daily-YYYY-MM-DD.md          full report  (~80 stories)
output/ai-radar/ai-daily-YYYY-MM-DD.json        same data, structured
output/ai-radar/ai-daily-YYYY-MM-DD.video.md    broadcast script (~5 stories)
output/ai-radar/ai-daily-YYYY-MM-DD.video.json  renderer contract
```

Two artifacts, on purpose. The **report** is the record — complete coverage,
built to skim. The **video cut** is the read-out: a linear bulletin the viewer
cannot skip past, so it holds only what is worth reporting out.

`.video.json` is the contract for the slide/video stage. Each segment carries:

| Field | Use |
|---|---|
| `headline` | slide title, ≤9 words, cut at a clause boundary |
| `subhead` | the organization the story is **about** |
| `via` | the outlet it came through, when different |
| `lowerThird` | `MODEL RELEASE` / `FUNDING` / `POLICY` / … |
| `narration` | the VO line, ≤30 words |
| `durationSec` | estimate at 2.5 words/sec, incl. transition |
| `visualHint` | `model-card`, `figure-callout`, `document`, `chart` |
| `sourceCount` | outlets corroborating, for an on-screen cue |

`totalDurationSec` on the script gives the runtime before anything renders.

### Narration is extractive, never generative

Every VO line is taken from the source title or summary — nothing is invented.
A bulletin that hallucinates a funding figure is worse than no bulletin. That
constrains quality: a line reads only as well as the source wrote it. LLM
rewriting is Phase 5 in [PLAN.md](PLAN.md); the interface will not change.

Sentences must pass an informativeness check — they need a named organization,
model, or number, and forum chatter is rejected outright. Before that gate, one
slide's entire VO was *"This post was not written by a clanker."*

Tune the cut:

```bash
node ai-radar/src/cli.js --stories 8 --min-score 45
```

## How it works

```
watchlist.json → poll (conditional GET) → relevance gate → classify
              → dedupe → cluster → score → daily report
```

Five channel handlers cover ~30 sources:

| Kind | Notes |
|---|---|
| `rss` | Standard feeds. Also handles GitHub `releases.atom`. |
| `sitemap` | For sites with no RSS — Anthropic, Mistral, ByteDance, DeepSeek. Follows sitemap indexes one level. |
| `github_releases` | Per-repo release tags. |
| `hf_models` | Hugging Face org API — the catch-all that per-repo feeds cannot provide. |
| `json_api` | Hacker News (multi-query) and arXiv. |

Not automated in v1: `html` (needs Playwright — MiniMax, Jiqizhixin) and
`x_syndication` (needs a tweet-ID discovery step). Both are recorded in the
watchlist with their status so the gap stays visible.

## Three things worth knowing before changing it

**Polling is stateful.** `ai-radar/state/sources.json` holds each source's
ETag and its seen-URL baseline. Delete it and the next run re-seeds: dated items
inside the window are reported, undated ones are suppressed. That asymmetry is
deliberate — Mistral's sitemap has no `<lastmod>`, so without a baseline its
entire 237-article back catalogue would arrive as breaking news.

**The daily report accumulates.** The collector only returns items it has not
seen before, so a second run in the same day legitimately collects zero. Reports
are therefore merged into the existing day's JSON rather than overwriting it —
otherwise running the radar twice would replace a full report with an empty one.

**The relevance gate is doing real work.** Aggregators carry far more than AI:
a live run filtered out 64 of 143 items, including saber-toothed cat research,
an OpenJDK proposal, and a GeForce NOW gaming promo. First-party channels skip
the gate; broad feeds — including Nvidia's and AWS's own blogs — do not.

## Politeness

Crawl rules are imported from the parent project's
`src/config/crawl-policy.js`, not redefined: **403 is a hard stop**, 429/5xx are
retried with backoff, requests to one host are serialized. The user-agent
identifies the tool honestly so any operator can block it by name.

Sources whose operators decline automated collection are listed under
`excluded` in the watchlist and are never polled. See PLAN.md §10b.

## Tests

```bash
node --test test/ai-radar.test.js
```

Covers the relevance gate, signal classification, clustering (both the merge and
the must-not-merge cases), and watchlist selection. Each regression test names
the real misbehavior it prevents.
