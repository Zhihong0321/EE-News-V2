# Local News Fetcher

Fetches three newest articles published today from a selected news site and writes them to JSON.

## Setup

```powershell
npm install
npx playwright install chromium
```

## Run

```powershell
npm run fetch:thestar
```

For Sin Chew Daily:

```powershell
npm run fetch:sinchew
```

Other configured sites:

```powershell
npm run fetch:chinapress
npm run fetch:theedge
npm run fetch:utusan
```

Results are written to `output/<site>-YYYY-MM-DD.json`.

Shared crawl pacing lives in `src/config/crawl-policy.js`. Site URLs, selectors, and extraction rules live in `src/sites/<site>.config.js` and `src/sites/<site>.js`.

For the maintenance model, read `docs/ARCHITECTURE.md`, `docs/ADDING_SITE.md`, and `docs/SOP.md` before changing the runner, adding a site, or repairing a broken adapter.

The runner can use verified RSS/Atom discovery and HTTP-first article extraction when a site adapter opts in. Playwright remains the fallback. Utusan currently uses its RSS feed and HTTP extraction path; the other configured sites remain Playwright-first until individually verified.

The fetcher waits 5 seconds between article pages, runs sequentially, stops on HTTP 403/429, checks `robots.txt`, and records failed URLs. The Star's `robots.txt` states that automated scraping/data mining requires prior permission; use this fetcher only where you have that permission.
