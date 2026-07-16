import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { crawlPolicy } from '../config/crawl-policy.js';
import { runtimeConfig } from '../config/runtime.js';
import { checkRobotsTxt } from './robots.js';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function writeResult(adapter, today, articles, failures, outputRoot) {
  await fs.mkdir(outputRoot, { recursive: true });
  const outputPath = path.join(outputRoot, `${adapter.id}-${today}.json`);
  const result = {
    source: adapter.source,
    fetched_at: new Date().toISOString(),
    requested: adapter.articleLimit,
    count: articles.length,
    failures,
    articles
  };
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { outputPath, result };
}

export async function runSite(adapter, { browser, outputDirectory } = {}) {
  const outputRoot = outputDirectory || path.resolve(process.cwd(), 'output');
  const today = adapter.today();
  const robots = await checkRobotsTxt(adapter.latestUrl, crawlPolicy.userAgent);
  for (const warning of robots.warnings) console.warn(`${adapter.source}: ${warning}`);
  if (!robots.allowed) {
    const error = new Error(`robots.txt disallows ${adapter.latestUrl} (${robots.blockedRule})`);
    await writeResult(adapter, today, [], [{ url: adapter.latestUrl, reason: error.message }], outputRoot);
    throw error;
  }

  let activeBrowser = browser;
  let ownsBrowser = false;
  let context = null;
  const ensureContext = async () => {
    if (!activeBrowser) {
      activeBrowser = await launchBrowser();
      ownsBrowser = true;
    }
    if (!context) context = await createContext(activeBrowser, adapter);
    return context;
  };

  let currentUrl = adapter.latestUrl;
  try {
    let candidates = null;
    if (typeof adapter.collectLinksHttp === 'function') {
      try {
        candidates = await adapter.collectLinksHttp(today);
      } catch (error) {
        if (crawlPolicy.stopStatuses.includes(error.status)) throw error;
        console.warn(`${adapter.source}: HTTP discovery failed; using browser discovery (${error.message})`);
      }
    }

    if (!candidates || candidates.length === 0) {
      const siteContext = await ensureContext();
      const listingPage = await siteContext.newPage();
      candidates = await adapter.collectLinks(listingPage, today);
      await listingPage.close();
    }

    const articles = [];
    const failures = [];
    for (const candidate of candidates) {
      if (articles.length >= adapter.articleLimit) break;
      currentUrl = candidate.href;
      await sleep(crawlPolicy.pageDelayMs);
      let article = null;
      let lastError = null;

      if (typeof adapter.readArticleHttp === 'function') {
        for (let attempt = 1; attempt <= crawlPolicy.retryCount; attempt += 1) {
          try {
            article = await adapter.readArticleHttp(candidate, today);
            break;
          } catch (error) {
            lastError = error;
            if (crawlPolicy.stopStatuses.includes(error.status)) throw error;
            if (attempt < crawlPolicy.retryCount) await sleep(crawlPolicy.retryDelayMs);
          }
        }
        if (!article && lastError) {
          console.warn(`${adapter.source}: HTTP article extraction failed for ${candidate.href}; using browser fallback.`);
        }
      }

      if (!article) {
        const siteContext = await ensureContext();
        for (let attempt = 1; attempt <= crawlPolicy.retryCount; attempt += 1) {
          try {
            article = await adapter.readArticle(siteContext, candidate, today);
            break;
          } catch (error) {
            lastError = error;
            if (crawlPolicy.stopStatuses.includes(error.status)) throw error;
            if (attempt < crawlPolicy.retryCount) await sleep(crawlPolicy.retryDelayMs);
          }
        }
      }

      if (article?.title && article.body) {
        articles.push(article);
      } else {
        const reason = lastError?.message || 'missing title or article body';
        failures.push({ url: candidate.href, reason });
        console.warn(`Skipped ${candidate.href}: ${reason}`);
      }
    }

    const saved = await writeResult(adapter, today, articles, failures, outputRoot);
    console.log(`Saved ${articles.length} article(s) to ${saved.outputPath}`);
    if (articles.length < adapter.articleLimit) {
      console.warn(`Only ${articles.length} valid ${adapter.source} article(s) were found for ${today}.`);
    }
    return saved;
  } catch (error) {
    await writeResult(adapter, today, [], [{ url: currentUrl, reason: error.message }], outputRoot);
    throw error;
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (ownsBrowser && activeBrowser) await activeBrowser.close();
    }
  }
}

export async function runSites(adapters, { concurrency = runtimeConfig.maxConcurrentSites, outputDirectory } = {}) {
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
        results[index] = await runSite(adapter, { browser, outputDirectory });
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
