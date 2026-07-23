import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkRobotsTxt } from '../../src/core/robots.js';
import { crawlPolicy } from '../../src/config/crawl-policy.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = path.resolve(HERE, '../python/crawl4ai_fetch.py');
const RUNTIME_ROOT = path.resolve(HERE, '../.runtime');
const LOCAL_PYTHON = process.platform === 'win32'
  ? path.resolve(HERE, '../.venv/Scripts/python.exe')
  : path.resolve(HERE, '../.venv/bin/python');
const DEFAULT_PYTHON = fs.existsSync(LOCAL_PYTHON) ? LOCAL_PYTHON : 'python';

function runProcess(command, args, { timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        CRAWL4_AI_BASE_DIRECTORY: RUNTIME_ROOT
      }
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr.trim() || `Crawl4AI process exited with code ${code}`));
      try {
        const jsonLine = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
        resolve(JSON.parse(jsonLine));
      } catch {
        reject(new Error(`Crawl4AI returned invalid JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

export function createCrawl4aiFetcher({ pythonCommand = process.env.CRAWL4AI_PYTHON || DEFAULT_PYTHON, scriptPath = DEFAULT_SCRIPT, processRunner = runProcess } = {}) {
  return async function crawl4aiFetch(url) {
    const robots = await checkRobotsTxt(url, crawlPolicy.userAgent);
    if (!robots.allowed) {
      const error = new Error(`robots.txt disallows ${url} (${robots.blockedRule})`);
      error.code = 'ROBOTS_DISALLOWED';
      throw error;
    }
    const result = await processRunner(pythonCommand, [scriptPath, url], {});
    if (crawlPolicy.stopStatuses.includes(result.statusCode)) {
      const error = new Error(`Crawl4AI returned HTTP ${result.statusCode} for ${url}`);
      error.status = result.statusCode;
      throw error;
    }
    if (!result.success) throw new Error(result.error || `Crawl4AI could not extract ${url}`);
    return { ...result, robots };
  };
}
