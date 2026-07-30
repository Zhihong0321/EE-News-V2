import { loadEnv } from '../config/env.js';
import * as directDb from './store.js';
import * as hubDb from './hub-client.js';

loadEnv();

// runner.js's only DB dependency. When HUB_URL is set, articles go through a
// Railway-hosted Hub over HTTPS instead of a direct Postgres connection — the
// point being that a fetcher running off Railway never holds a DATABASE_URL,
// so Postgres traffic stays inside Railway's free private network and this
// machine never incurs Railway's public-Postgres egress cost.
const backend = process.env.HUB_URL ? hubDb : directDb;

export const { isDbEnabled, getExistingArticleUrls, persistArticles, recordStageStatus } = backend;
