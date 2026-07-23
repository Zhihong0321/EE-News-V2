#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool, isDbEnabled, databaseUrl } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function maskUrl(url) {
  return url ? url.replace(/(:\/\/[^:]+:)[^@]+@/, '$1****@') : '(none)';
}

async function main() {
  const command = process.argv[2] || 'up';
  if (!isDbEnabled()) {
    console.error('No database configured. Add DATABASE_URL (or SUPABASE_DB_URL) to your .env first.');
    process.exitCode = 1;
    return;
  }
  console.log(`Database: ${maskUrl(databaseUrl())}`);

  if (command === 'test') {
    const { rows } = await getPool().query('select now() as now, version() as version');
    console.log(`Connected. Server time: ${rows[0].now}`);
    console.log(rows[0].version);
    return;
  }

  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('Schema applied: articles, article_enrichments (+ indexes).');
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());
