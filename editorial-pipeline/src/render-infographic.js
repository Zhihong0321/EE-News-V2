import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInfographicDocument } from '../templates/infographic/render.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(HERE, '../templates/infographic');
const SUPPORT_JS_PATH = path.join(TEMPLATE_DIR, 'support.js');

function baseSlug(packetPath) {
  return path.basename(packetPath, '.json').replace(/^infographic_/, '');
}

export function infographicHtmlOutputName(packetPath, index, total) {
  const slug = baseSlug(packetPath);
  const suffix = total > 1 ? `-${index + 1}` : '';
  return `infographic_${slug}${suffix}.dc.html`;
}

async function ensureSupportJs(directory) {
  const target = path.join(directory, 'support.js');
  const source = await fs.readFile(SUPPORT_JS_PATH, 'utf8');
  try {
    const existing = await fs.readFile(target, 'utf8');
    if (existing === source) return target;
  } catch {
    // not present yet — write it below
  }
  await fs.writeFile(target, source, 'utf8');
  return target;
}

export async function renderInfographicPacket(packetPath, {
  outputDirectory,
  colorway,
  defaultLang,
  storageKeyPrefix,
  animations
} = {}) {
  const absolutePacketPath = path.resolve(packetPath);
  const packet = JSON.parse(await fs.readFile(absolutePacketPath, 'utf8'));
  const articles = Array.isArray(packet.articles) ? packet.articles : [];
  const enriched = articles
    .map((article, index) => ({ article, index }))
    .filter(({ article }) => article.status === 'enriched');
  if (enriched.length === 0) throw new Error(`No enriched articles found in ${absolutePacketPath}`);

  const directory = path.resolve(outputDirectory || path.dirname(absolutePacketPath));
  await fs.mkdir(directory, { recursive: true });
  const supportJsPath = await ensureSupportJs(directory);

  // Best-effort: dynamically loaded so the editorial pipeline still runs
  // where the db layer/pg dependency is absent.
  let db = null;
  try {
    const mod = await import('../../src/db/store.js');
    if (mod.isDbEnabled()) db = mod;
  } catch (error) {
    console.warn(`Render status tracking unavailable: ${error.message}`);
  }

  // Each article renders independently — one bad article (malformed
  // enrichment content, template edge case) must not block the rest of the
  // batch from writing out.
  const rendered = [];
  const failures = [];
  for (const { article, index } of enriched) {
    const url = article.coreNews?.url;
    const articleId = db && url ? await db.getArticleIdByUrl(url).catch(() => null) : null;
    try {
      if (articleId) await db.recordStageStatus(articleId, 'render', 'pending').catch(() => {});
      const html = renderInfographicDocument(article, { colorway, defaultLang, storageKeyPrefix, animations });
      const fileName = infographicHtmlOutputName(absolutePacketPath, index, enriched.length);
      const outputPath = path.join(directory, fileName);
      await fs.writeFile(outputPath, html, 'utf8');
      rendered.push({ outputPath, title: article.infographicContent?.coreNews?.displayTitle?.en || article.coreNews?.title });
      if (articleId) await db.recordStageStatus(articleId, 'render', 'done').catch(() => {});
    } catch (error) {
      console.warn(`Render failed for ${url || article.coreNews?.title || 'unknown article'}: ${error.message}`);
      failures.push({ url, title: article.coreNews?.title, reason: error.message });
      if (articleId) await db.recordStageStatus(articleId, 'render', 'failed', error.message).catch(() => {});
    }
  }
  if (rendered.length === 0) throw new Error(`No articles could be rendered from ${absolutePacketPath}`);

  return { supportJsPath, rendered, failures };
}
