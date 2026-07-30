import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './config/env.js';
import { listAdapters, getAdapter } from './sites/index.js';
import { listCustomAdapters, getCustomAdapter, saveCustomConfig, validateNewSiteInput } from './sites/custom-registry.js';
import { runSite } from './core/runner.js';
import { runPipeline } from './core/pipeline.js';
import { listCrawlJobs, summarizeCrawlJobs } from './core/factory-status.js';
import { getPipelineDashboard, isDbEnabled, getExistingArticleUrls, persistArticles, recordStageStatus } from './db/store.js';
import { databaseUrl, query as dbQuery } from './db/pool.js';
import { retryFailedStages, retryableStages } from './core/retry-pipeline.js';
import { snapshot as llmHealthSnapshot } from './core/llm-health.js';
import {
  ROUTABLE_TASKS,
  API_STYLES,
  listProviders,
  createProvider as createLlmProvider,
  updateProvider as updateLlmProvider,
  deleteProvider as deleteLlmProvider,
  addModel as addLlmModel,
  deleteModel as deleteLlmModel,
  listRoutes,
  setTaskChain,
  getProviderSecret
} from './db/llm-config.js';
import { invalidate as invalidateLlmRouting, buildRequest, extractText } from './core/llm-registry.js';

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUTPUT_DIR = path.resolve(process.cwd(), 'output');
const EDITORIAL_OUTPUT_DIR = path.resolve(process.cwd(), 'editorial-pipeline/output');
const PORT = Number(process.env.PORT) || 5177;
const FACTORY_PASSWORD = process.env.FACTORY_PASSWORD || '';
if (!FACTORY_PASSWORD) {
  console.warn('\n  WARNING: FACTORY_PASSWORD is not set. The factory dashboard is LOCKED — no password will be accepted.\n  Set FACTORY_PASSWORD in your environment to enable operator access.\n');
}
// Machine-to-machine key for /api/hub/* — lets a fetcher running off-Railway
// (e.g. a local machine) write through this server instead of holding a
// direct Postgres connection, so Postgres reads/writes stay on Railway's free
// private network and only small JSON payloads cross the public internet.
const HUB_API_KEY = process.env.HUB_API_KEY || '';
if (!HUB_API_KEY) {
  console.warn('\n  WARNING: HUB_API_KEY is not set. The /api/hub/* endpoints are LOCKED — no key will be accepted.\n  Set HUB_API_KEY in your environment to let a remote fetcher write through this hub.\n');
}
// Upper bound for `since` backfills. Big enough for real multi-day pulls,
// bounded so a backfill can never run forever (was `Infinity`). Configurable
// via BACKFILL_MAX; see .env.example.
const BACKFILL_MAX = Number(process.env.BACKFILL_MAX) > 0 ? Number(process.env.BACKFILL_MAX) : 300;
const PUBLISHED_CACHE_MS = 5000;
const FACTORY_COOKIE = 'factory_session';
const FACTORY_SESSION = crypto.randomBytes(32).toString('hex');
const OUTPUT_FILE_PATTERN = /^([a-z0-9-]+)-(\d{4}-\d{2}-\d{2})\.json$/;
const INFOGRAPHIC_PACKET_PATTERN = /^infographic_(.+)\.json$/;
const SINCE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Files inside editorial-pipeline/output that the reader may fetch: the
// rendered infographic pages and the shared support script they load.
const RENDERED_FILE_PATTERN = /^(?:infographic_[a-z0-9-]+(?:-\d+)?\.dc\.html|support\.js)$/;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8'
};

const fetchLocks = new Set();

async function allAdapterSummaries() {
  const custom = await listCustomAdapters();
  return [...listAdapters(), ...custom].map((adapter) => ({
    id: adapter.id,
    source: adapter.source,
    country: adapter.country,
    latestUrl: adapter.latestUrl,
    timezone: adapter.timezone,
    transport: adapter.transport,
    articleLimit: adapter.articleLimit,
    candidateLimit: adapter.candidateLimit,
    custom: Boolean(adapter.custom),
    busy: fetchLocks.has(adapter.id)
  }));
}

async function resolveAdapter(id) {
  try {
    return getAdapter(id);
  } catch {
    return getCustomAdapter(id);
  }
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function passwordMatches(candidate) {
  if (!FACTORY_PASSWORD) return false;
  const expected = crypto.createHash('sha256').update(FACTORY_PASSWORD).digest();
  const actual = crypto.createHash('sha256').update(String(candidate || '')).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function isHubAuthenticated(req) {
  if (!HUB_API_KEY) return false;
  const expected = crypto.createHash('sha256').update(HUB_API_KEY).digest();
  const actual = crypto.createHash('sha256').update(String(req.headers['x-hub-key'] || '')).digest();
  return crypto.timingSafeEqual(expected, actual);
}

function requestCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function isFactoryAuthenticated(req) {
  const candidate = requestCookies(req)[FACTORY_COOKIE] || '';
  const expected = Buffer.from(FACTORY_SESSION);
  const actual = Buffer.from(candidate);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function factoryCookie(req, value, maxAge) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${FACTORY_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

async function listOutputFiles() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const files = (await fs.readdir(OUTPUT_DIR)).filter((file) => OUTPUT_FILE_PATTERN.test(file));
  const summaries = [];
  for (const file of files) {
    const [, site, date] = file.match(OUTPUT_FILE_PATTERN);
    try {
      const raw = await fs.readFile(path.join(OUTPUT_DIR, file), 'utf8');
      const data = JSON.parse(raw);
      summaries.push({
        file,
        site,
        date,
        source: data.source,
        country: data.articles?.[0]?.country,
        count: data.count ?? (data.articles || []).length,
        requested: data.requested,
        failures: (data.failures || []).length,
        fetched_at: data.fetched_at
      });
    } catch (error) {
      summaries.push({ file, site, date, error: `Could not read file: ${error.message}` });
    }
  }
  summaries.sort((a, b) => (b.fetched_at || '').localeCompare(a.fetched_at || ''));
  return summaries;
}

function lastNDays(count) {
  const days = [];
  const now = new Date();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

async function buildFetchStats({ days = 7 } = {}) {
  const dateList = lastNDays(days);
  const dateSet = new Set(dateList);
  const files = await listOutputFiles();

  const countsBySite = new Map();
  const sourceBySite = new Map();
  for (const summary of files) {
    if (!dateSet.has(summary.date)) continue;
    if (!countsBySite.has(summary.site)) countsBySite.set(summary.site, {});
    countsBySite.get(summary.site)[summary.date] = summary.count || 0;
    if (summary.source) sourceBySite.set(summary.site, summary.source);
  }

  const adapters = await allAdapterSummaries();
  const knownIds = new Set(adapters.map((adapter) => adapter.id));
  const siteIds = [...new Set([...knownIds, ...countsBySite.keys()])];

  const rows = siteIds.map((id) => {
    const adapter = adapters.find((entry) => entry.id === id);
    const counts = countsBySite.get(id) || {};
    const daily = dateList.map((date) => counts[date] || 0);
    return {
      id,
      source: adapter?.source || sourceBySite.get(id) || id,
      daily,
      total: daily.reduce((sum, value) => sum + value, 0)
    };
  });
  rows.sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));

  return { days: dateList, rows };
}

function publishedTimestamp(article) {
  const parsed = Date.parse(article?.published_at || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

// Directory param is injectable so tests can pin the render-file convention
// against a temp directory (see test/rendered-path.test.js).
export async function listPublishedArticles(directory = EDITORIAL_OUTPUT_DIR) {
  await fs.mkdir(directory, { recursive: true });
  const files = (await fs.readdir(directory)).filter((file) => INFOGRAPHIC_PACKET_PATTERN.test(file));
  const articlesByUrl = new Map();
  // Every reason an enriched article fails to reach the site is counted so the
  // dashboard (and this log) can say exactly why, instead of silent loss.
  const skipped = { notEnriched: 0, missingRender: 0, staleMtime: 0, missingFields: 0, packetErrors: 0 };

  for (const file of files) {
    try {
      const packetPath = path.join(directory, file);
      const raw = await fs.readFile(packetPath, 'utf8');
      const data = JSON.parse(raw);
      const all = data.articles || [];
      const enriched = all
        .map((article, index) => ({ article, index }))
        .filter(({ article }) => article.status === 'enriched');
      skipped.notEnriched += all.length - enriched.length;
      const packetStat = await fs.stat(packetPath);

      for (const { article: entry, index } of enriched) {
        const suffix = enriched.length > 1 ? `-${index + 1}` : '';
        const base = file.match(INFOGRAPHIC_PACKET_PATTERN)[1];
        const renderFile = `infographic_${base}${suffix}.dc.html`;
        const renderPath = path.join(directory, renderFile);
        let renderStat;
        try {
          renderStat = await fs.stat(renderPath);
        } catch {
          skipped.missingRender += 1;
          continue;
        }
        if (!renderStat.isFile()) {
          skipped.missingRender += 1;
          continue;
        }
        if (renderStat.mtimeMs < packetStat.mtimeMs) {
          skipped.staleMtime += 1;
          continue;
        }

        const rawArticle = entry.coreNews || {};
        const display = entry.infographicContent?.coreNews || {};
        const url = String(rawArticle.url || display.sourceUrl || '').trim();
        const displayTitle = display.displayTitle;
        const summary = display.summary;
        // Ship ONLY the enriched, transformed bilingual fields. The raw source
        // title/body are never sent to the browser (copyright) — a non-empty raw
        // body just gates that the packet came from a real source article, and a
        // present bilingual displayTitle + summary proves it was actually enriched.
        const hasRawBody = String(rawArticle.body || '').trim().length > 0;
        const hasDisplay = displayTitle?.en && displayTitle?.zh && summary?.en && summary?.zh;
        if (!url || !hasRawBody || !hasDisplay) {
          skipped.missingFields += 1;
          continue;
        }

        const publishedAt = rawArticle.published_at || rawArticle.fetched_at || data.fetchedAt || '';
        const candidate = {
          url,
          source: rawArticle.source || data.source || '',
          country: rawArticle.country || '',
          section: rawArticle.section || '',
          tags: Array.isArray(rawArticle.tags)
            ? rawArticle.tags.map((tag) => String(tag || '').trim()).filter(Boolean)
            : [],
          author: rawArticle.author || '',
          displayTitle,
          summary,
          keyFacts: Array.isArray(display.keyFacts) ? display.keyFacts : [],
          file,
          published_at: publishedAt,
          publication_status: 'rendered',
          render_file: renderFile,
          rendered_at: renderStat.mtime.toISOString()
        };
        const existing = articlesByUrl.get(url);
        if (!existing || candidate.rendered_at > existing.rendered_at) articlesByUrl.set(url, candidate);
      }
    } catch (error) {
      // Invalid enrichment packets and incomplete renders stay unpublished —
      // but no longer silently: name the packet and the reason.
      skipped.packetErrors += 1;
      console.warn(`[news] skipped packet ${file}: ${error.message}`);
    }
  }

  const articles = [...articlesByUrl.values()]
    .sort((a, b) => publishedTimestamp(b) - publishedTimestamp(a));

  const totalSkipped = skipped.notEnriched + skipped.missingRender + skipped.staleMtime
    + skipped.missingFields + skipped.packetErrors;
  if (totalSkipped) {
    console.log(`[news] published ${articles.length} article(s); skipped ${totalSkipped} `
      + `(notEnriched=${skipped.notEnriched}, missingRender=${skipped.missingRender}, `
      + `staleMtime=${skipped.staleMtime}, missingFields=${skipped.missingFields}, `
      + `packetErrors=${skipped.packetErrors})`);
  }

  return {
    generated_at: new Date().toISOString(),
    count: articles.length,
    articles,
    skipped: { ...skipped, total: totalSkipped }
  };
}

let publishedCache = { at: 0, value: null };

// Short-lived cache so /api/news (unauthenticated) and the status poll don't
// each re-read + re-stat the whole editorial directory on every hit.
async function getPublishedArticles({ force = false } = {}) {
  const now = Date.now();
  if (!force && publishedCache.value && now - publishedCache.at < PUBLISHED_CACHE_MS) {
    return publishedCache.value;
  }
  const value = await listPublishedArticles();
  publishedCache = { at: now, value };
  return value;
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? '/index.html'
    : pathname === '/read' || pathname === '/read/' ? '/read.html'
    : pathname === '/factory' || pathname === '/factory/' ? '/factory.html'
    : pathname === '/factory/stats' || pathname === '/factory/stats/' ? '/factory-stats.html'
    : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${relative}`);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'cache-control': pathname.startsWith('/factory') ? 'no-store' : 'public, max-age=60'
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function runFactoryFetch(adapter, { since } = {}) {
  fetchLocks.add(adapter.id);
  // Full chain: fetch -> enrich -> render. Enrich/render are best-effort inside
  // runPipeline (a dead LLM can't fail the crawl), so the factory button now
  // advances an article all the way to a rendered infographic in one action.
  // A since-backfill has no fixed daily target - the adapter's normal
  // articleLimit exists to cap a single "today" run, not a multi-day pull.
  const provider = process.env.PIPELINE_PROVIDER || 'agy';
  runPipeline(adapter, {
    outputDirectory: OUTPUT_DIR,
    editorialOutputDirectory: EDITORIAL_OUTPUT_DIR,
    since,
    articleLimit: since ? BACKFILL_MAX : undefined,
    provider
  })
    .catch((error) => console.error(`${adapter.source} pipeline failed: ${error.message}`))
    .finally(() => fetchLocks.delete(adapter.id));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    // Hub API: write-through for a fetcher running off Railway. Mirrors
    // db/store.js's function signatures 1:1 so hub-client.js is a drop-in
    // swap for a direct DATABASE_URL — see db/runner-backend.js.
    if (pathname.startsWith('/api/hub/') && !isHubAuthenticated(req)) {
      return sendJson(res, 401, { ok: false, error: 'Hub authentication required' });
    }

    if (pathname === '/api/hub/existing-urls' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const urls = Array.isArray(body.urls) ? body.urls : [];
      const existing = await getExistingArticleUrls(urls);
      return sendJson(res, 200, { ok: true, existing: [...existing] });
    }

    if (pathname === '/api/hub/persist-articles' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const articles = Array.isArray(body.articles) ? body.articles : [];
      const idsByUrl = await persistArticles(articles);
      return sendJson(res, 200, { ok: true, ids: [...idsByUrl.entries()] });
    }

    if (pathname === '/api/hub/stage-status' && req.method === 'POST') {
      const body = await readJsonBody(req);
      await recordStageStatus(body.articleId, body.stage, body.status, body.error ?? null);
      return sendJson(res, 200, { ok: true });
    }

    // Read-only health probe for confirming a deploy is wired correctly:
    // real DB ping (not just "DATABASE_URL is set"), whether that connection
    // is Railway's free private network vs a metered public one, and current
    // pipeline stage counts. Meant to be curled from wherever you're
    // debugging from, not browsed.
    if (pathname === '/api/hub/debug/status' && req.method === 'GET') {
      const dbUrl = databaseUrl();
      let dbConnected = false;
      let dbError = null;
      if (dbUrl) {
        try {
          await dbQuery('select 1');
          dbConnected = true;
        } catch (error) {
          dbError = error.message;
        }
      }
      let dbHost = null;
      let dbPrivate = null;
      if (dbUrl) {
        try {
          dbHost = new URL(dbUrl).hostname;
          dbPrivate = /\.railway\.internal$/i.test(dbHost);
        } catch {
          // malformed connection string — leave host/private as null
        }
      }
      const dashboard = await getPipelineDashboard({ limit: 1 });
      return sendJson(res, 200, {
        ok: true,
        db: {
          configured: Boolean(dbUrl),
          connected: dbConnected,
          error: dbError,
          host: dbHost,
          private: dbPrivate
        },
        pipeline: { counts: dashboard.counts },
        process: {
          pid: process.pid,
          uptimeSeconds: Math.round(process.uptime()),
          nodeVersion: process.version
        }
      });
    }

    if (pathname === '/api/factory/session' && req.method === 'GET') {
      return sendJson(res, 200, { authenticated: isFactoryAuthenticated(req) });
    }

    if (pathname === '/api/factory/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!passwordMatches(body.password)) {
        return sendJson(res, 401, { ok: false, error: 'Invalid factory password' });
      }
      return sendJson(res, 200, { ok: true }, {
        'set-cookie': factoryCookie(req, FACTORY_SESSION, 12 * 60 * 60)
      });
    }

    if (pathname === '/api/factory/logout' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true }, {
        'set-cookie': factoryCookie(req, '', 0)
      });
    }

    if (pathname.startsWith('/api/factory/') && !isFactoryAuthenticated(req)) {
      return sendJson(res, 401, { ok: false, error: 'Factory authentication required' });
    }

    if (pathname === '/api/factory/status' && req.method === 'GET') {
      const jobs = await listCrawlJobs({ outputDirectory: OUTPUT_DIR });
      let pipeline;
      try {
        pipeline = await getPipelineDashboard();
      } catch (error) {
        pipeline = {
          enabled: isDbEnabled(),
          counts: [],
          articles: [],
          error: error.message
        };
      }
      let published;
      try {
        const list = await getPublishedArticles();
        published = { count: list.count, skipped: list.skipped };
      } catch (error) {
        published = { count: 0, skipped: null, error: error.message };
      }
      return sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        summary: summarizeCrawlJobs(jobs),
        jobs,
        pipeline,
        published,
        llm: llmHealthSnapshot()
      });
    }

    if (pathname === '/api/factory/retry' && req.method === 'POST') {
      if (!isDbEnabled()) return sendJson(res, 400, { ok: false, error: 'Retry requires a database (set DATABASE_URL or SUPABASE_DB_URL)' });
      const body = await readJsonBody(req);
      const stage = body.stage ? String(body.stage) : undefined;
      if (stage && !retryableStages().includes(stage)) {
        return sendJson(res, 400, { ok: false, error: `Unknown retryable stage "${stage}" (available: ${retryableStages().join(', ')})` });
      }
      try {
        const summary = await retryFailedStages({ stage });
        return sendJson(res, 200, { ok: true, ...summary });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (pathname === '/api/factory/fix-corrupted' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const model = body.model || 'Gemini 3.6 Flash (Low)';
      const targetFile = body.file ? String(body.file) : null;
      try {
        const { createProvider } = await import('./core/enrich-provider.js');
        const { enrichNewsFile } = await import('../editorial-pipeline/src/enrich-news.js');
        const { renderInfographicPacket } = await import('../editorial-pipeline/src/render-infographic.js');
        const { isCorruptedContent, needsContentRefill, cleanCorruptedText } = await import('../editorial-pipeline/src/utils.js');

        const provider = createProvider('agy', { model });
        const results = [];

        const files = await fs.readdir(EDITORIAL_OUTPUT_DIR).catch(() => []);
        for (const f of files) {
          if (!f.startsWith('infographic_') || !f.endsWith('.json')) continue;
          if (targetFile && f !== targetFile && !f.endsWith(targetFile)) continue;

          const packetPath = path.join(EDITORIAL_OUTPUT_DIR, f);
          const rawContent = await fs.readFile(packetPath, 'utf8').catch(() => '');
          if (!isCorruptedContent(rawContent)) continue;

          let packetObj = null;
          try { packetObj = JSON.parse(rawContent); } catch {}
          if (!packetObj) continue;

          // Pass 1: Immediate sanitization of reversible character glitches.
          // Replacement characters have lost their source bytes, so deleting them
          // would make the packet look clean while leaving broken text on screen.
          const sanitizedPacket = cleanCorruptedText(packetObj);
          if (!needsContentRefill(packetObj) && !isCorruptedContent(sanitizedPacket)) {
            await fs.writeFile(packetPath, `${JSON.stringify(sanitizedPacket, null, 2)}\n`, 'utf8');
            const renderResult = await renderInfographicPacket(packetPath, { outputDirectory: EDITORIAL_OUTPUT_DIR });
            results.push({
              file: f,
              method: 'sanitized',
              enrichedCount: sanitizedPacket.count || sanitizedPacket.articles?.length || 1,
              renderedCount: renderResult.rendered.length
            });
            continue;
          }

          // Pass 2: Refill via AGY if sanitization alone is incomplete
          const rawName = f.replace(/^infographic_/, '');
          let inputPath = path.join(OUTPUT_DIR, rawName);
          let isTempInput = false;

          try {
            await fs.stat(inputPath);
          } catch {
            const rawArticles = (packetObj.articles || []).map(a => a.coreNews).filter(Boolean);
            if (rawArticles.length === 0 && packetObj.coreNews) rawArticles.push(packetObj.coreNews);

            if (rawArticles.length > 0) {
              await fs.mkdir(path.join(OUTPUT_DIR, '.factory'), { recursive: true });
              inputPath = path.join(OUTPUT_DIR, '.factory', `temp_refill_${rawName}`);
              await fs.writeFile(inputPath, `${JSON.stringify(rawArticles, null, 2)}\n`, 'utf8');
              isTempInput = true;
            }
          }

          try {
            const { outputPath, packet } = await enrichNewsFile(inputPath, {
              provider,
              outputDirectory: EDITORIAL_OUTPUT_DIR,
              concurrency: 2,
              skipDedupe: true
            });

            if (isTempInput && outputPath !== packetPath) {
              const cleanedPacket = cleanCorruptedText(packet);
              await fs.writeFile(packetPath, `${JSON.stringify(cleanedPacket, null, 2)}\n`, 'utf8');
              await fs.unlink(outputPath).catch(() => {});
            }

            const renderResult = await renderInfographicPacket(packetPath, { outputDirectory: EDITORIAL_OUTPUT_DIR });
            results.push({
              file: f,
              method: 'agy-refill',
              enrichedCount: packet.count,
              renderedCount: renderResult.rendered.length
            });
          } finally {
            if (isTempInput) {
              await fs.unlink(inputPath).catch(() => {});
            }
          }
        }

        publishedCache = { at: 0, value: null };
        return sendJson(res, 200, { ok: true, model, processed: results });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    // --- LLM control plane -------------------------------------------------
    // Providers + models + per-task fallback chains, all DB-backed. Every write
    // invalidates the routing cache so a running crawl picks up the change on
    // its next article rather than after a restart.
    //
    // When HUB_URL is set, this whole subtree is forwarded verbatim to the
    // Hub's /api/hub/llm/* routes instead of touching a local DATABASE_URL —
    // this machine then never even sees a plaintext provider API key.
    if (pathname.startsWith('/api/factory/llm') && process.env.HUB_URL) {
      const hubBase = process.env.HUB_URL.replace(/\/+$/, '');
      const targetPath = pathname.replace('/api/factory/llm', '/api/hub/llm');
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      let bodyText;
      if (hasBody) {
        const parsed = await readJsonBody(req).catch(() => ({}));
        bodyText = JSON.stringify(parsed);
      }
      try {
        const hubResponse = await fetch(`${hubBase}${targetPath}${url.search}`, {
          method: req.method,
          headers: {
            'content-type': 'application/json',
            'x-hub-key': process.env.HUB_API_KEY || ''
          },
          body: bodyText
        });
        const payload = await hubResponse.json().catch(() => ({ ok: false, error: 'Invalid response from hub' }));
        return sendJson(res, hubResponse.status, payload);
      } catch (error) {
        return sendJson(res, 502, { ok: false, error: `Hub request failed: ${error.message}` });
      }
    }

    if (pathname === '/api/factory/llm' && req.method === 'GET') {
      if (!isDbEnabled()) {
        return sendJson(res, 200, {
          ok: true, enabled: false, tasks: ROUTABLE_TASKS, apiStyles: API_STYLES,
          providers: [], routes: {},
          error: 'LLM settings require a database (set DATABASE_URL or SUPABASE_DB_URL)'
        });
      }
      try {
        const [providers, routes] = await Promise.all([listProviders(), listRoutes()]);
        return sendJson(res, 200, { ok: true, enabled: true, tasks: ROUTABLE_TASKS, apiStyles: API_STYLES, providers, routes });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (pathname.startsWith('/api/factory/llm') && !isDbEnabled()) {
      return sendJson(res, 400, { ok: false, error: 'LLM settings require a database (set DATABASE_URL or SUPABASE_DB_URL)' });
    }

    if (pathname === '/api/factory/llm/providers' && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const id = await createLlmProvider({
          name: body.name,
          apiStyle: body.apiStyle || 'anthropic',
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
          enabled: body.enabled !== false,
          notes: body.notes ?? null
        });
        // Convenience: accept a models array on create so adding a provider and
        // its models is one action in the UI instead of two round-trips.
        for (const model of Array.isArray(body.models) ? body.models : []) {
          const entry = typeof model === 'string' ? { model } : model;
          if (entry?.model) await addLlmModel(id, entry);
        }
        invalidateLlmRouting();
        return sendJson(res, 201, { ok: true, id });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    const llmProviderMatch = pathname.match(/^\/api\/factory\/llm\/providers\/(\d+)$/);
    if (llmProviderMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const providerId = Number(llmProviderMatch[1]);
      try {
        if (req.method === 'DELETE') {
          const removed = await deleteLlmProvider(providerId);
          invalidateLlmRouting();
          return sendJson(res, removed ? 200 : 404, { ok: removed, error: removed ? undefined : 'Provider not found' });
        }
        const body = await readJsonBody(req);
        const updated = await updateLlmProvider(providerId, body);
        invalidateLlmRouting();
        return sendJson(res, updated ? 200 : 404, { ok: updated, error: updated ? undefined : 'Provider not found or no fields to update' });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    const llmModelsMatch = pathname.match(/^\/api\/factory\/llm\/providers\/(\d+)\/models$/);
    if (llmModelsMatch && req.method === 'POST') {
      const body = await readJsonBody(req);
      try {
        const id = await addLlmModel(Number(llmModelsMatch[1]), {
          model: body.model,
          label: body.label ?? null,
          enabled: body.enabled !== false
        });
        invalidateLlmRouting();
        return sendJson(res, 201, { ok: true, id });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    const llmModelMatch = pathname.match(/^\/api\/factory\/llm\/models\/(\d+)$/);
    if (llmModelMatch && req.method === 'DELETE') {
      try {
        const removed = await deleteLlmModel(Number(llmModelMatch[1]));
        invalidateLlmRouting();
        return sendJson(res, removed ? 200 : 404, { ok: removed, error: removed ? undefined : 'Model not found' });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    // Replace one task's whole ordered chain. body: { entries: [{ modelId, enabled }] }
    const llmRouteMatch = pathname.match(/^\/api\/factory\/llm\/routes\/([a-z]+)$/);
    if (llmRouteMatch && req.method === 'PUT') {
      const task = llmRouteMatch[1];
      const body = await readJsonBody(req);
      try {
        const count = await setTaskChain(task, Array.isArray(body.entries) ? body.entries : []);
        invalidateLlmRouting(task);
        return sendJson(res, 200, { ok: true, task, count });
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: error.message });
      }
    }

    // Live credential check: smallest possible completion against one model.
    if (pathname === '/api/factory/llm/test' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const providerId = Number(body.providerId);
      const model = String(body.model || '').trim();
      if (!Number.isInteger(providerId) || !model) {
        return sendJson(res, 400, { ok: false, error: 'providerId and model are required' });
      }
      const provider = await getProviderSecret(providerId);
      if (!provider) return sendJson(res, 404, { ok: false, error: 'Provider not found' });

      // 2048 tokens, not a handful: models that emit a reasoning block before
      // the answer return an EMPTY answer if the budget only covers reasoning,
      // which would report a perfectly healthy key as broken.
      const request = buildRequest({ ...provider, token: provider.apiKey, model }, 'Reply with exactly: OK', { maxTokens: 2048 });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const startedAt = Date.now();
      try {
        const response = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: JSON.stringify(request.body),
          signal: controller.signal
        });
        const latencyMs = Date.now() - startedAt;
        if (!response.ok) {
          const raw = await response.text().catch(() => '');
          let message = raw.slice(0, 200);
          try { message = JSON.parse(raw).error?.message || message; } catch { /* keep raw */ }
          return sendJson(res, 200, { ok: false, status: response.status, latencyMs, error: message });
        }
        const payload = await response.json();
        const text = extractText(payload, provider.apiStyle).trim();
        return sendJson(res, 200, {
          ok: Boolean(text),
          status: response.status,
          latencyMs,
          reply: text.slice(0, 120),
          error: text ? undefined : 'Endpoint answered but returned empty text (model may have spent the token budget on reasoning)'
        });
      } catch (error) {
        return sendJson(res, 200, { ok: false, latencyMs: Date.now() - startedAt, error: error.message });
      } finally {
        clearTimeout(timer);
      }
    }

    if (pathname === '/api/factory/fetch-stats' && req.method === 'GET') {
      const days = Math.min(31, Math.max(1, Number(url.searchParams.get('days')) || 7));
      return sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), ...(await buildFetchStats({ days })) });
    }

    if (pathname === '/api/factory/sites' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, sites: await allAdapterSummaries() });
    }

    if (pathname === '/api/factory/sites/fetch-all' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const since = body.since ? String(body.since) : null;
      if (since && !SINCE_DATE_PATTERN.test(since)) {
        return sendJson(res, 400, { ok: false, error: 'since must be a YYYY-MM-DD date' });
      }
      const custom = await listCustomAdapters();
      const adapters = [...listAdapters(), ...custom];
      const dispatched = [];
      const busy = [];
      for (const adapter of adapters) {
        if (fetchLocks.has(adapter.id)) {
          busy.push(adapter.id);
          continue;
        }
        runFactoryFetch(adapter, { since });
        dispatched.push(adapter.id);
      }
      return sendJson(res, 202, { ok: true, since, dispatched, busy });
    }

    const factoryFetchMatch = pathname.match(/^\/api\/factory\/sites\/([a-z0-9-]+)\/fetch$/);
    if (factoryFetchMatch && req.method === 'POST') {
      const id = factoryFetchMatch[1];
      if (fetchLocks.has(id)) return sendJson(res, 409, { ok: false, error: `A fetch for "${id}" is already running` });
      const adapter = await resolveAdapter(id);
      if (!adapter) return sendJson(res, 404, { ok: false, error: `Unknown site "${id}"` });
      const body = await readJsonBody(req);
      const since = body.since ? String(body.since) : null;
      if (since && !SINCE_DATE_PATTERN.test(since)) {
        return sendJson(res, 400, { ok: false, error: 'since must be a YYYY-MM-DD date' });
      }
      runFactoryFetch(adapter, { since });
      return sendJson(res, 202, { ok: true, site: id, since });
    }

    if (pathname === '/api/sites' && req.method === 'GET') {
      return sendJson(res, 200, await allAdapterSummaries());
    }

    if (pathname === '/api/sites' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const existing = (await allAdapterSummaries()).map((site) => site.id);
      const { errors, config } = validateNewSiteInput(body, existing);
      if (errors.length) return sendJson(res, 400, { ok: false, errors });
      await saveCustomConfig(config);
      return sendJson(res, 201, { ok: true, site: config });
    }

    const fetchMatch = pathname.match(/^\/api\/sites\/([a-z0-9-]+)\/fetch$/);
    if (fetchMatch && req.method === 'POST') {
      // Same trigger as /api/factory/sites/:id/fetch — must sit behind the same
      // factory session so it can't be hammered anonymously.
      if (!isFactoryAuthenticated(req)) {
        return sendJson(res, 401, { ok: false, error: 'Factory authentication required' });
      }
      const id = fetchMatch[1];
      if (fetchLocks.has(id)) return sendJson(res, 409, { ok: false, error: `A fetch for "${id}" is already running` });
      const adapter = await resolveAdapter(id);
      if (!adapter) return sendJson(res, 404, { ok: false, error: `Unknown site "${id}"` });

      fetchLocks.add(id);
      try {
        const saved = await runSite(adapter, { outputDirectory: OUTPUT_DIR });
        return sendJson(res, 200, { ok: true, result: saved.result });
      } catch (error) {
        return sendJson(res, 502, { ok: false, error: error.message });
      } finally {
        fetchLocks.delete(id);
      }
    }

    if (pathname === '/api/articles' && req.method === 'GET') {
      return sendJson(res, 200, await listOutputFiles());
    }

    if (pathname === '/api/news' && req.method === 'GET') {
      return sendJson(res, 200, await getPublishedArticles());
    }

    const renderedMatch = pathname.match(/^\/rendered\/([^/]+)$/);
    if (renderedMatch && req.method === 'GET') {
      const name = decodeURIComponent(renderedMatch[1]);
      if (!RENDERED_FILE_PATTERN.test(name)) {
        return sendJson(res, 404, { ok: false, error: 'Rendered file not found' });
      }
      const filePath = path.join(EDITORIAL_OUTPUT_DIR, name);
      if (!filePath.startsWith(`${EDITORIAL_OUTPUT_DIR}${path.sep}`)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
          'content-type': CONTENT_TYPES[path.extname(name)] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        res.end(data);
      } catch {
        sendJson(res, 404, { ok: false, error: 'Rendered file not found' });
      }
      return;
    }

    const fileMatch = pathname.match(/^\/api\/articles\/([a-z0-9-]+-\d{4}-\d{2}-\d{2}\.json)$/);
    if (fileMatch && req.method === 'GET') {
      const filePath = path.join(OUTPUT_DIR, fileMatch[1]);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(raw);
      } catch {
        sendJson(res, 404, { ok: false, error: 'Output file not found' });
      }
      return;
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { ok: false, error: 'Not found' });
    }

    return await serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

export { server };

// Only listen when run directly (`node src/server.js`), not when imported by a
// test that exercises exported helpers like listPublishedArticles.
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  server.listen(PORT, () => {
    console.log(`News crawler UI running at http://localhost:${PORT}`);
  });
}
