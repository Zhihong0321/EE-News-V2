import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { generateTagsAndCountry } from '../core/tagger.js';
import { isDbEnabled } from '../db/store.js';
import { query } from '../db/pool.js';

loadEnv();

const EDITORIAL_OUTPUT_DIR = path.resolve(process.cwd(), 'editorial-pipeline/output');
const INFOGRAPHIC_PACKET_PATTERN = /^infographic_(.+)\.json$/;

async function backfillTags({ limit = 300, concurrency = 12 } = {}) {
  await fs.mkdir(EDITORIAL_OUTPUT_DIR, { recursive: true });
  const files = (await fs.readdir(EDITORIAL_OUTPUT_DIR)).filter((file) => INFOGRAPHIC_PACKET_PATTERN.test(file));
  console.log(`Found ${files.length} infographic packet(s) in ${EDITORIAL_OUTPUT_DIR}.`);

  const pendingTasks = [];
  const modifiedPackets = new Map();

  for (const file of files) {
    const packetPath = path.join(EDITORIAL_OUTPUT_DIR, file);
    let packet;
    try {
      const raw = await fs.readFile(packetPath, 'utf8');
      packet = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!Array.isArray(packet.articles)) continue;

    for (const entry of packet.articles) {
      if (entry.status !== 'enriched' || !entry.coreNews) continue;
      const rawArticle = entry.coreNews;
      if (Array.isArray(rawArticle.tags) && rawArticle.tags.length > 0 && rawArticle.country) continue;
      
      pendingTasks.push({ rawArticle, packetPath, packet });
      if (pendingTasks.length >= limit) break;
    }
    if (pendingTasks.length >= limit) break;
  }

  if (pendingTasks.length === 0) {
    console.log('All articles already have tags and country set. Nothing to backfill!');
    return;
  }

  console.log(`Queueing ${pendingTasks.length} article(s) for fast parallel processing (concurrency=${concurrency})...`);

  let completedCount = 0;
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= pendingTasks.length) return;
      const { rawArticle, packetPath, packet } = pendingTasks[index];

      try {
        const meta = await generateTagsAndCountry(rawArticle);
        rawArticle.tags = meta.tags;
        if (meta.country) {
          rawArticle.country = meta.country;
        }
        modifiedPackets.set(packetPath, packet);
        completedCount++;
        console.log(`[${completedCount}/${pendingTasks.length}] Done: "${(rawArticle.title || '').slice(0, 35)}..." -> country: ${rawArticle.country}, tags: ${JSON.stringify(meta.tags.slice(0, 3))}`);

        if (isDbEnabled() && rawArticle.url) {
          await query(`UPDATE articles SET tags = $1, country = $2, updated_at = now() WHERE url = $3;`, [meta.tags, rawArticle.country, rawArticle.url]).catch(() => {});
        }
      } catch (error) {
        console.warn(`[${index + 1}] Failed for ${rawArticle.url}: ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pendingTasks.length) }, () => worker()));

  for (const [packetPath, packet] of modifiedPackets.entries()) {
    await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
    try {
      const { renderInfographicPacket } = await import('../../editorial-pipeline/src/render-infographic.js');
      await renderInfographicPacket(packetPath, { outputDirectory: EDITORIAL_OUTPUT_DIR });
    } catch (err) {
      console.warn(`[backfill-tags] Could not re-render ${path.basename(packetPath)}: ${err.message}`);
    }
  }

  console.log(`\nBackfill completed! Updated ${completedCount} article(s) across ${modifiedPackets.size} packet(s).`);
}

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 300;

const concurrencyArg = process.argv.find((a) => a.startsWith('--concurrency='));
const concurrency = concurrencyArg ? Number(concurrencyArg.split('=')[1]) : 12;

backfillTags({ limit, concurrency }).catch((err) => {
  console.error(err);
  process.exit(1);
});
