import pg from 'pg';
import { loadEnv } from '../config/env.js';

loadEnv();

const { Pool } = pg;

let pool = null;

/**
 * Returns the DATABASE_URL (or SUPABASE_DB_URL) from the environment, or null
 * when no database is configured. When null, callers should skip persistence
 * so the crawler keeps working as a pure JSON producer.
 */
export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || null;
}

export function isDbEnabled() {
  return Boolean(databaseUrl());
}

function sslConfig(url) {
  if (process.env.DATABASE_SSL === 'false') return false;
  // Local databases don't use TLS; managed ones (Supabase, Railway) require it.
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  return { rejectUnauthorized: false };
}

/**
 * Lazily create a shared connection pool. Throws if no DATABASE_URL is set —
 * guard with isDbEnabled() first when persistence is optional.
 */
export function getPool() {
  if (pool) return pool;
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error('No database configured. Set DATABASE_URL (or SUPABASE_DB_URL) in .env');
  }
  pool = new Pool({
    connectionString,
    ssl: sslConfig(connectionString),
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000
  });
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
