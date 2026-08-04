// Channel dispatcher. Maps a watchlist `kind` to the handler that executes it.
//
// A handler exports either:
//   parse(body, source)  — the common case; collect.js does the conditional GET
//   collect(source, ctx) — full control, for channels needing several requests
import * as rss from './rss.js';
import * as sitemap from './sitemap.js';
import * as hfModels from './hf-models.js';
import * as hackernews from './hackernews.js';

const HANDLERS = {
  rss,
  // GitHub's releases.atom is plain Atom — same parser, different meaning.
  github_releases: rss,
  sitemap,
  hf_models: hfModels
};

export function handlerFor(source) {
  if (source.kind === 'json_api') {
    // json_api covers several unrelated APIs; route on host.
    if (source.url?.includes('hn.algolia.com')) return hackernews;
    if (source.url?.includes('arxiv.org')) return rss; // arXiv's API returns Atom
    return null;
  }
  return HANDLERS[source.kind] || null;
}
