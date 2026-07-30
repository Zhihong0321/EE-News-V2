import { loadEnv } from '../config/env.js';

loadEnv();

// Talks to a Hub server's /api/hub/* routes instead of Postgres directly.
// Exports the same signatures as store.js (isDbEnabled, getExistingArticleUrls,
// persistArticles, recordStageStatus) so runner-backend.js can swap this in
// without runner.js knowing the difference.

function hubUrl() {
  return (process.env.HUB_URL || '').replace(/\/+$/, '');
}

function hubApiKey() {
  return process.env.HUB_API_KEY || '';
}

export function isDbEnabled() {
  return Boolean(hubUrl() && hubApiKey());
}

async function hubRequest(routePath, body) {
  let response;
  try {
    response = await fetch(`${hubUrl()}${routePath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-key': hubApiKey()
      },
      body: JSON.stringify(body)
    });
  } catch (cause) {
    // No HTTP status on a network-level failure — withRetry() in runner.js
    // treats that as transient and retries it.
    const error = new Error(`Hub request to ${routePath} failed: ${cause.message}`);
    error.cause = cause;
    throw error;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // non-JSON body — payload stays null, status still drives error handling
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Hub request to ${routePath} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function getExistingArticleUrls(urls) {
  if (!isDbEnabled() || !Array.isArray(urls) || urls.length === 0) return new Set();
  const payload = await hubRequest('/api/hub/existing-urls', { urls });
  return new Set(payload?.existing || []);
}

export async function persistArticles(articles) {
  const idsByUrl = new Map();
  if (!isDbEnabled() || !Array.isArray(articles) || articles.length === 0) return idsByUrl;
  const payload = await hubRequest('/api/hub/persist-articles', { articles });
  for (const [url, id] of payload?.ids || []) idsByUrl.set(url, id);
  return idsByUrl;
}

export async function recordStageStatus(articleId, stage, status, error = null) {
  if (!isDbEnabled() || !articleId || !stage || !status) return;
  await hubRequest('/api/hub/stage-status', {
    articleId,
    stage,
    status,
    error: error ? String(error).slice(0, 500) : null
  });
}
