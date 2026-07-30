import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { crawlPolicy, isRetryable, isHardStop } from '../config/crawl-policy.js';
import { runtimeConfig } from '../config/runtime.js';
import { checkRobotsTxt } from './robots.js';
import { persistArticles, isDbEnabled, getExistingArticleUrls, recordStageStatus } from '../db/runner-backend.js';
import { createCrawlJob } from './factory-status.js';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Retry `fn` on transient failures only. A hard-stop error (403) is re-thrown
// immediately so the caller can abort the whole crawl; a client error (4xx) or
// any other non-retryable outcome fails fast without another attempt. Resolves
// to { value, error }: `value` is the first successful result (or null if every
// attempt failed), `error` the last error seen (or null on success).
async function withRetry(fn, { retries = crawlPolicy.retryCount, shouldRetry = isRetryable } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return { value: await fn(), error: null };
    } catch (error) {
      lastError = error;
      if (isHardStop(error)) throw error;
      if (!shouldRetry(error)) break;
      if (attempt < retries) await sleep(crawlPolicy.retryDelayMs);
    }
  }
  return { value: null, error: lastError };
}

async function launchBrowser() {
  return chromium.launch({ headless: true });
}

async function createContext(browser, adapter) {
  const context = await browser.newContext({
    locale: 'en-MY',
    timezoneId: adapter.timezone,
    userAgent: crawlPolicy.userAgent
  });
  await context.route('**/*', (route) => {
    if (crawlPolicy.blockResourceTypes.includes(route.request().resourceType())) return route.abort();
    return route.continue();
  });
  return context;
}

async function writeResult(adapter, today, articles, failures, outputRoot, { since, requested } = {}) {
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `${adapter.id}-${today}.json`);
  const result = {
    source: adapter.source,
    fetched_at: new Date().toISOString(),
    since: since || today,
    requested: requested === undefined ? adapter.articleLimit : (Number.isFinite(requested) ? requested : null),
    count: articles.length,
    failures,
    articles
  };
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { outputPath, result };
}

export async function runSite(adapter, { browser, outputDirectory, since, articleLimit } = {}) {
  const outputRoot = outputDirectory || path.resolve(process.cwd(), 'output');
  const today = adapter.today();
  // `sinceDate` is the site-local calendar-date floor (e.g. "2026-07-21")
  // passed to the adapter for filtering; `today` stays the actual run date,
  // used for the output filename/status regardless of how far back we look.
  const sinceDate = since || today;
  const effectiveLimit = articleLimit || adapter.articleLimit;
  const statusJob = createCrawlJob(adapter, {
    outputDirectory: outputRoot,
    target: Number.isFinite(effectiveLimit) ? effectiveLimit : null
  });
  await statusJob.ready;

  let activeBrowser = browser;
  let ownsBrowser = false;
  let context = null;
  let browserPromise = null;
  let contextPromise = null;
  let currentUrl = adapter.latestUrl;
  // Set once the crawl output file is written; guards the catch block from
  // clobbering a good output file with an empty failure record on a late error
  // (e.g. a DB persist failure after extraction already succeeded).
  let savedResult = null;

  const ensureContext = async () => {
    if (!activeBrowser) {
      if (!browserPromise) {
        ownsBrowser = true;
        browserPromise = launchBrowser();
      }
      activeBrowser = await browserPromise;
    }
    if (!contextPromise) contextPromise = createContext(activeBrowser, adapter);
    context = await contextPromise;
    return context;
  };

  try {
    await statusJob.stage('robots', 'Checking robots.txt policy');
    const robots = await checkRobotsTxt(adapter.latestUrl, crawlPolicy.userAgent);
    for (const warning of robots.warnings) console.warn(`${adapter.source}: ${warning}`);
    if (!robots.allowed) {
      throw new Error(`robots.txt disallows ${adapter.latestUrl} (${robots.blockedRule})`);
    }

    let candidates = null;
    if (typeof adapter.collectLinksHttp === 'function') {
      await statusJob.stage('discovering', 'Discovering article links over HTTP');
      try {
        candidates = await adapter.collectLinksHttp(sinceDate);
      } catch (error) {
        if (crawlPolicy.stopStatuses.includes(error.status)) throw error;
        console.warn(`${adapter.source}: HTTP discovery failed; using browser discovery (${error.message})`);
      }
    }

    if (!candidates || candidates.length === 0) {
      await statusJob.stage('discovering', 'Discovering article links in the browser');
      const siteContext = await ensureContext();
      const listingPage = await siteContext.newPage();
      candidates = await adapter.collectLinks(listingPage, sinceDate);
      await listingPage.close();
    }

    if (isDbEnabled() && candidates.length > 0) {
      await statusJob.stage('filtering', 'Checking for already-fetched articles');
      const existingUrls = await getExistingArticleUrls(candidates.map((candidate) => candidate.href));
      if (existingUrls.size > 0) {
        const beforeCount = candidates.length;
        candidates = candidates.filter((candidate) => !existingUrls.has(candidate.href));
        console.log(`${adapter.source}: skipped ${beforeCount - candidates.length} already-fetched article(s).`);
      }
    }
    await statusJob.setCandidates(candidates.length);

    const extractCandidate = async (candidate) => {
      let article = null;
      let lastError = null;

      if (typeof adapter.readArticleHttp === 'function') {
        const { value, error } = await withRetry(() => adapter.readArticleHttp(candidate, sinceDate));
        if (value) article = value;
        if (error) lastError = error;
        if (!article && lastError) {
          console.warn(`${adapter.source}: HTTP article extraction failed for ${candidate.href}; using browser fallback.`);
        }
      }

      if (!article) {
        const siteContext = await ensureContext();
        const { value, error } = await withRetry(() => adapter.readArticle(siteContext, candidate, sinceDate));
        if (value) article = value;
        if (error) lastError = error;
      }

      return { article, lastError };
    };

    const collected = new Array(candidates.length).fill(null);
    const failureList = [];
    let nextCandidate = 0;
    let validCount = 0;
    let stopError = null;

    async function articleWorker(workerNumber) {
      const workerId = `worker-${workerNumber}`;
      while (true) {
        if (stopError || validCount >= effectiveLimit) return;
        const index = nextCandidate;
        nextCandidate += 1;
        if (index >= candidates.length) return;
        const candidate = candidates[index];
        await sleep(crawlPolicy.pageDelayMs);
        if (stopError || validCount >= effectiveLimit) {
          // This candidate was claimed but the run stopped (limit reached or a
          // stop error) during its politeness delay. Record it as skipped so it
          // stays visible in the output instead of vanishing silently.
          failureList.push({
            index,
            url: candidate.href,
            skipped: true,
            reason: stopError ? `skipped: ${stopError.message}` : 'skipped: article limit reached'
          });
          return;
        }
        currentUrl = candidate.href;
        await statusJob.workerStarted(workerId, candidate);
        let result;
        try {
          result = await extractCandidate(candidate);
        } catch (error) {
          await statusJob.workerFinished(workerId, { ok: false, reason: error.message });
          stopError = error;
          currentUrl = candidate.href;
          return;
        }
        // Fetch stage is extract + persist ONLY — no LLM calls here. Keep any
        // article with a title and either a body or a description; only truly
        // empty extractions (no body AND no description) count as failures. Tags
        // and dedup_title are filled later by the async enrichment pass.
        if (result.article?.title && (result.article.body || result.article.description)) {
          collected[index] = result.article;
          validCount += 1;
          await statusJob.workerFinished(workerId, { ok: true });
        } else {
          const reason = result.lastError?.message || 'missing title and article body/description';
          failureList.push({ index, url: candidate.href, reason });
          console.warn(`Skipped ${candidate.href}: ${reason}`);
          await statusJob.workerFinished(workerId, { ok: false, reason });
        }
      }
    }

    const articleWorkers = Math.min(
      Math.max(1, crawlPolicy.articleConcurrency || 1),
      candidates.length
    );
    await Promise.all(Array.from({ length: articleWorkers }, (_, index) => articleWorker(index + 1)));
    if (stopError) throw stopError;

    const articles = [];
    for (const article of collected) {
      if (!article) continue;
      articles.push(article);
      if (articles.length >= effectiveLimit) break;
    }
    const failures = failureList
      .sort((a, b) => a.index - b.index)
      .map(({ url, reason }) => ({ url, reason }));

    await statusJob.stage('saving', 'Writing crawl output');
    const saved = await writeResult(adapter, today, articles, failures, outputRoot, { since: sinceDate, requested: effectiveLimit });
    savedResult = saved;
    console.log(`Saved ${articles.length} article(s) to ${saved.outputPath}`);
    if (isDbEnabled() && articles.length > 0) {
      await statusJob.stage('persisting', 'Persisting articles to the database');
      // DB persistence is a real pipeline stage, not warn-and-forget. Retry it
      // (transient DB blips), and if it still fails surface the error on the run
      // result + factory status instead of swallowing it — otherwise the rows,
      // and the enrichment pass that depends on them, are silently lost.
      const { value: idsByUrl, error: persistError } = await withRetry(() => persistArticles(articles));
      if (persistError) {
        saved.result.persistError = persistError.message;
        console.error(`Database persistence FAILED for ${adapter.source}: ${persistError.message}`);
        const failure = new Error(`Database persistence failed for ${adapter.source}: ${persistError.message}`);
        failure.code = 'DB_PERSIST_FAILED';
        failure.cause = persistError;
        throw failure;
      }
      console.log(`Stored ${idsByUrl.size} article(s) in the database.`);
      // Record enrichment stages as pending so the async enrichment pass picks
      // these freshly-fetched articles up. The worker makes NO LLM calls; tags
      // default to '{}' and dedup_title stays null until enrichment fills them.
      for (const article of articles) {
        const id = idsByUrl.get(article.url);
        if (!id) continue;
        await recordStageStatus(id, 'distill', 'pending');
        await recordStageStatus(id, 'tag', 'pending');
      }
    }
    if (articles.length < effectiveLimit) {
      console.warn(`Only ${articles.length} valid ${adapter.source} article(s) were found since ${sinceDate}.`);
    }
    await statusJob.complete(saved);
    return saved;
  } catch (error) {
    // Only write an empty failure record if we hadn't already written a good
    // output file — don't clobber successfully-extracted articles when a later
    // stage (e.g. DB persist) fails.
    if (!savedResult) {
      try {
        await writeResult(adapter, today, [], [{ url: currentUrl, reason: error.message }], outputRoot, { since: sinceDate });
      } catch (writeError) {
        console.warn(`Could not write failed crawl output for ${adapter.source}: ${writeError.message}`);
      }
    }
    await statusJob.fail(error);
    throw error;
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (ownsBrowser && activeBrowser) await activeBrowser.close();
    }
  }
}

export async function fetchAdapterArticle(adapter, url, { browser, date } = {}) {
  const robots = await checkRobotsTxt(url, crawlPolicy.userAgent);
  if (!robots.allowed) {
    const error = new Error(`robots.txt disallows ${url} (${robots.blockedRule})`);
    error.code = 'ROBOTS_DISALLOWED';
    throw error;
  }

  const candidate = { href: url, title: '' };
  const targetDate = date || adapter.today();
  let activeBrowser = browser;
  let ownsBrowser = false;
  let context = null;
  let lastError = null;

  try {
    if (typeof adapter.readArticleHttp === 'function') {
      const { value, error } = await withRetry(() => adapter.readArticleHttp(candidate, targetDate));
      if (error) lastError = error;
      if (value?.title && value.body) return { article: value, transport: 'http', robots };
    }

    if (!activeBrowser) {
      activeBrowser = await launchBrowser();
      ownsBrowser = true;
    }
    context = await createContext(activeBrowser, adapter);
    {
      const { value, error } = await withRetry(() => adapter.readArticle(context, candidate, targetDate));
      if (error) lastError = error;
      if (value?.title && value.body) return { article: value, transport: 'playwright', robots };
    }

    const error = new Error(lastError?.message || `Adapter ${adapter.id} could not extract ${url}`);
    error.code = 'ADAPTER_EXTRACTION_FAILED';
    throw error;
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (ownsBrowser && activeBrowser) await activeBrowser.close();
    }
  }
}

export async function runSites(adapters, { concurrency = runtimeConfig.maxConcurrentSites, outputDirectory, since, articleLimit } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`concurrency must be a positive integer; received ${concurrency}`);
  }
  if (!adapters.length) return [];
  const browser = await launchBrowser();
  const results = new Array(adapters.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), adapters.length);

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= adapters.length) return;
      const adapter = adapters[index];
      try {
        results[index] = await runSite(adapter, { browser, outputDirectory, since, articleLimit });
      } catch (error) {
        results[index] = { site: adapter.id, error: error.stack || error.message };
        console.error(`${adapter.source} failed: ${error.message}`);
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  } finally {
    await browser.close();
  }
}
