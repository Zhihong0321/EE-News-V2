# Project Handoff

This is a deliberately small local news-fetcher monolith. The current goal is reliable JSON collection before building an aggregator.

Before changing code:

- Read `docs/ARCHITECTURE.md` and `docs/ADDING_SITE.md`.
- Keep shared crawl behavior in `src/core/runner.js`, `src/core/robots.js`, and `src/config/crawl-policy.js`.
- Keep machine capacity in `src/config/runtime.js`; do not put concurrency limits into site politeness settings.
- Keep selectors, navigation, date rules, and article-body extraction inside `src/sites/<site>.js` and its config.
- Do not add a database, API server, queue, microservices, fingerprint randomization, IP rotation, or paywall bypass without an explicit new requirement.
- Run `npm test` after code changes and perform a live fetch only when network verification is needed.

The adapter contract is validated by `src/sites/index.js`. Output is local JSON under `output/`.

Transport is opt-in per adapter: RSS/Atom and HTTP extraction may be used only after live verification. A 403/429 is a hard stop; never escalate around it.
