import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildAgyCommand, createAgyCallGate, isAgyPoolExhaustedError } from '../src/providers/agy-gemini.js';

test('AGY requests use the Legion rotation runner when session rotation is enabled', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-runner-'));
  const runner = path.join(directory, 'run-agy-agent.mjs');
  await fs.writeFile(runner, '', 'utf8');

  const command = buildAgyCommand({
    bin: 'C:/agy/agy.exe',
    runner,
    useSessionRotation: true,
    cwd: 'E:/001-news-crawler-v2',
    model: 'Gemini 3.6 Flash (High)',
    prompt: 'Return AGY_OK'
  });

  assert.equal(command.command, process.execPath);
  assert.deepEqual(command.args, [runner, 'E:/001-news-crawler-v2', 'Gemini 3.6 Flash (High)', 'Return AGY_OK']);
  assert.equal(command.usesSessionRotation, true);
});

test('AGY can explicitly opt out of session rotation', () => {
  const command = buildAgyCommand({
    bin: 'C:/agy/agy.exe',
    runner: 'C:/missing/run-agy-agent.mjs',
    useSessionRotation: false,
    cwd: 'E:/001-news-crawler-v2',
    model: 'Gemini 3.6 Flash (High)',
    prompt: 'Return AGY_OK'
  });

  assert.equal(command.command, 'C:/agy/agy.exe');
  assert.deepEqual(command.args, ['-p', 'Return AGY_OK', '--model', 'Gemini 3.6 Flash (High)', '--dangerously-skip-permissions']);
  assert.equal(command.usesSessionRotation, false);
});

test('AGY gate permits three active calls while spacing their starts', async () => {
  const gate = createAgyCallGate({ maxConcurrent: 3, minStartGapMs: 20 });
  const starts = [];

  await Promise.all(Array.from({ length: 3 }, () => gate.run(async () => {
    starts.push(Date.now());
  })));

  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 15);
  assert.ok(starts[2] - starts[1] >= 15);
});

test('AGY pool exhaustion errors are detected for an immediate fallback', () => {
  assert.equal(isAgyPoolExhaustedError(new Error('All agy sessions exhausted. Last: quota')), true);
  assert.equal(isAgyPoolExhaustedError(new Error('No ready agy session (all cooling down / unauth).')), true);
  assert.equal(isAgyPoolExhaustedError({ message: 'agy failed', agyOutput: 'All agy sessions exhausted. Last: quota' }), true);
  assert.equal(isAgyPoolExhaustedError(new Error('agy timed out after 240000ms')), false);
});
