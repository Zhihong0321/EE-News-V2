import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { isDbEnabled } from '../db/store.js';
import { query } from '../db/pool.js';

loadEnv();

const EDITORIAL_OUTPUT_DIR = path.resolve(process.cwd(), 'editorial-pipeline/output');
const INFOGRAPHIC_PACKET_PATTERN = /^infographic_(.+)\.json$/;

async function clearTagProgress() {
  console.log('Clearing tag progress across local packets and database...');

  // 1. Clear tags in local infographic_*.json packets
  await fs.mkdir(EDITORIAL_OUTPUT_DIR, { recursive: true });
  const files = (await fs.readdir(EDITORIAL_OUTPUT_DIR)).filter((file) => INFOGRAPHIC_PACKET_PATTERN.test(file));
  let clearedPackets = 0;
  let clearedArticles = 0;

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

    let modified = false;
    for (const entry of packet.articles) {
      if (entry?.coreNews) {
        if (Array.isArray(entry.coreNews.tags) && entry.coreNews.tags.length > 0) {
          entry.coreNews.tags = [];
          clearedArticles += 1;
          modified = true;
        }
      }
    }

    if (modified) {
      clearedPackets += 1;
      await fs.writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
    }
  }

  console.log(`Cleared tags in ${clearedArticles} article(s) across ${clearedPackets} local JSON packet(s).`);

  // 2. Clear tags in Database if DB is enabled
  if (isDbEnabled()) {
    try {
      const articleRes = await query(`UPDATE articles SET tags = '{}', updated_at = now();`);
      console.log(`Reset tags in database articles table (${articleRes.rowCount ?? 0} rows).`);

      const statusRes = await query(`
        INSERT INTO article_pipeline_status (article_id, stage, status, updated_at)
        SELECT id, 'tag', 'pending', now() FROM articles
        ON CONFLICT (article_id, stage) DO UPDATE SET
          status = 'pending',
          attempts = 0,
          last_error = null,
          next_retry_at = null,
          updated_at = now();
      `);
      console.log(`Reset tag pipeline stage status to 'pending' in database (${statusRes.rowCount ?? 0} rows).`);
    } catch (error) {
      console.warn(`Database tag progress reset warning: ${error.message}`);
    }
  } else {
    console.log('Database not enabled; skipped DB tag progress reset.');
  }

  console.log('\nTag progress has been completely cleared. You can now retry tagging whenever you like (e.g. node src/tools/backfill-tags.js or npm run enrich).');
}

clearTagProgress().catch((err) => {
  console.error(err);
  process.exit(1);
});
