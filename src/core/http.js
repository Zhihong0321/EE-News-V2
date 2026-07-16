import { crawlPolicy } from '../config/crawl-policy.js';
import { runtimeConfig } from '../config/runtime.js';

export async function fetchText(url, { accept = '*/*' } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtimeConfig.httpTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept,
        'user-agent': crawlPolicy.userAgent
      },
      signal: controller.signal
    });
    if (crawlPolicy.stopStatuses.includes(response.status)) {
      const error = new Error(`HTTP ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > runtimeConfig.maxResponseBytes) {
      throw new Error(`Response exceeded ${runtimeConfig.maxResponseBytes} bytes for ${url}`);
    }
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      totalBytes += chunk.length;
      if (totalBytes > runtimeConfig.maxResponseBytes) {
        throw new Error(`Response exceeded ${runtimeConfig.maxResponseBytes} bytes for ${url}`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHtml(url) {
  return fetchText(url, { accept: 'text/html,application/xhtml+xml' });
}
