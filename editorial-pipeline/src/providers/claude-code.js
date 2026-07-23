// Claude Code CLI enrichment provider.
// Spawns `claude` CLI headlessly with `-p <prompt> --print --dangerously-skip-permissions`.
import { spawn } from 'node:child_process';
import { articleCutoffDate } from '../enrichment-prompt.js';
import { validateEnrichment } from '../enrichment-validator.js';

const DEFAULT_CLAUDE_BIN = 'claude';
const DEFAULT_MODEL = 'claude-3-7-sonnet-20250219';

function tryParseJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function hasEnrichmentShape(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false;
  if (!content.coreNews || typeof content.coreNews !== 'object') return false;
  return Array.isArray(content.dimensions) && content.dimensions.length > 0;
}

function stampVerbatimFields(content, article) {
  if (content?.coreNews && typeof content.coreNews === 'object' && article) {
    content.coreNews.originalTitle = article.title;
    content.coreNews.sourceUrl = article.url;
  }
  return content;
}

function runClaudeCode({ bin, model, prompt, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const args = ['-p', '-', '--print', '--dangerously-skip-permissions'];
    let child;
    try {
      child = spawn(bin, args, { shell: false, windowsHide: true, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      reject(new Error(`claude-code spawn failed: ${error.message}`));
      return;
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    const timer = setTimeout(() => {
      child.kill();
      const e = new Error(`claude-code timed out after ${timeoutMs}ms`);
      e.name = 'AbortError';
      reject(e);
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdoutChunks.push(d); });
    child.stderr.on('data', (d) => { stderrChunks.push(d); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`claude-code spawn failed: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdoutChunks).toString('utf8');
      const err = Buffer.concat(stderrChunks).toString('utf8');
      if (code === 0) return resolve(out);
      const e = new Error(`claude-code failed (exit ${code}): ${(err || out).trim().slice(0, 300)}`);
      reject(e);
    });
    child.stdin.write(prompt, 'utf8');
    child.stdin.end();
  });
}

const JSON_RULE = '\n\nReturn ONLY the final JSON object defined in the OUTPUT SCHEMA. No markdown code fences, no commentary before or after — raw JSON only.';

export function createClaudeCodeProvider(options = {}) {
  const bin = options.bin || process.env.CLAUDE_BIN || DEFAULT_CLAUDE_BIN;
  const model = options.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || 240000;
  const cwd = options.cwd || process.cwd();

  return {
    id: `claude-code:${model}`,
    async enrich(prompt, article) {
      const rawText = await runClaudeCode({ bin, model, prompt: prompt + JSON_RULE, cwd, timeoutMs });
      const content = tryParseJson(rawText);
      if (!content || !hasEnrichmentShape(content)) {
        throw new Error('claude-code did not return a valid enrichment JSON object');
      }
      stampVerbatimFields(content, article);
      return {
        content,
        rawText,
        provenance: {
          provider: 'claude-code',
          model,
          responseStatus: 'ok',
          passes: 1,
          attempts: 1
        }
      };
    }
  };
}
