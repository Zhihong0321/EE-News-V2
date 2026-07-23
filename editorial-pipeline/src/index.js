import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCrawl4aiFetcher } from './crawl4ai-bridge.js';
import { createFetchPage } from './fetch-page.js';
import { enrichNewsFile, infographicOutputName } from './enrich-news.js';
import { buildEnrichmentPrompt } from './enrichment-prompt.js';
import { validateEnrichment } from './enrichment-validator.js';
import { replayResearchPacket } from './packet-store.js';
import { createBraveProvider } from './providers/brave.js';
import { createCavotiTerraProvider } from './providers/cavoti-terra.js';
import { createFixtureProvider } from './providers/fixture.js';
import { ResearchSession } from './research-session.js';
import { createSearchWeb } from './search-web.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const defaultOutputDirectory = path.resolve(HERE, '../output');

export function createResearchBench(options = {}) {
  let provider = options.searchProvider;
  if (!provider && process.env.RESEARCH_SEARCH_FIXTURE) {
    provider = createFixtureProvider(process.env.RESEARCH_SEARCH_FIXTURE);
  }
  if (!provider) provider = createBraveProvider(options.brave);

  const searchWeb = options.searchWeb || createSearchWeb({
    providers: { [provider.id]: provider },
    defaultProvider: provider.id
  });
  const crawl4aiFetcher = options.crawl4aiFetcher || createCrawl4aiFetcher(options.crawl4ai);
  const fetchPage = options.fetchPage || createFetchPage({
    crawl4aiFetcher,
    adapterFinder: options.adapterFinder,
    adapterFetcher: options.adapterFetcher,
    clock: options.clock
  });

  return {
    searchWeb,
    fetchPage,
    createSession(question, sessionOptions = {}) {
      return new ResearchSession({
        question,
        searchWeb,
        fetchPage,
        clock: options.clock,
        ...sessionOptions
      });
    },
    replay: replayResearchPacket
  };
}

export {
  createCrawl4aiFetcher,
  createFetchPage,
  createSearchWeb,
  createBraveProvider,
  createCavotiTerraProvider,
  createFixtureProvider,
  buildEnrichmentPrompt,
  validateEnrichment,
  enrichNewsFile,
  infographicOutputName,
  ResearchSession,
  replayResearchPacket
};
