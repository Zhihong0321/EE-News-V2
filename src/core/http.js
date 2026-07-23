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
    const buffer = Buffer.concat(chunks);
    const contentType = response.headers.get('content-type') || '';
    let charsetMatch = contentType.match(/charset=([a-zA-Z0-9_-]+)/i);
    if (!charsetMatch) {
      const head = buffer.subarray(0, 2048).toString('ascii');
      charsetMatch = head.match(/<meta[^>]+charset=["']?([a-zA-Z0-9_-]+)/i);
    }
    const charset = charsetMatch ? charsetMatch[1].toLowerCase() : 'utf-8';
    if (charset !== 'utf-8' && charset !== 'utf8') {
      try {
        return new TextDecoder(charset).decode(buffer);
      } catch {}
    }
    const decodedUtf8 = buffer.toString('utf8');
    if (decodedUtf8.includes('\uFFFD')) {
      try {
        const decodedGbk = new TextDecoder('gbk').decode(buffer);
        if (!decodedGbk.includes('\uFFFD')) {
          return decodedGbk;
        }
      } catch {}
    }
    return decodedUtf8;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchHtml(url) {
  return fetchText(url, { accept: 'text/html,application/xhtml+xml' });
}
