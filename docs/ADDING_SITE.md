# Adding A Site

Use this sequence for every new source.

1. Create `src/sites/<id>.config.js` with `id`, `source`, `latestUrl`, `timezone`, `transport`, limits, and selectors.
2. Create `src/sites/<id>.js` with the adapter contract:
   - `today()` using the site's timezone
   - `collectLinks(page, today)`
   - `readArticle(context, link, today)`
3. Keep navigation and extraction logic in that adapter. Do not add site selectors to `src/core/runner.js`.
4. If RSS or HTTP extraction is verified, add `feedUrls` or optional `collectLinksHttp`/`readArticleHttp` methods. Keep Playwright fallback for incomplete HTTP results.
5. Register the adapter in `src/sites/index.js`.
6. Add an npm script only if the site is used often, for example `fetch:<id>`.
7. Run `npm test`.
8. Run a live fetch manually and inspect `output/<id>-YYYY-MM-DD.json`.
9. Record unusual behavior in the site config or a short note in this directory.

## Definition of done

- Three valid same-day articles, or an explicit fewer-than-three result.
- Full visible article body without bypassing login, paywall, or locked content.
- Correct timezone and publication date.
- No selectors or delays copied into the shared runner unless they are truly global.
- Zero failures for the validation run, or failures explained in the JSON output.
