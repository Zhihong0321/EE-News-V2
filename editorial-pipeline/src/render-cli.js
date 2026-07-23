#!/usr/bin/env node
import path from 'node:path';
import { renderInfographicPacket } from './render-infographic.js';

function parseArguments(values) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    flags[key] = next && !next.startsWith('--') ? values[++index] : true;
  }
  return { positional, flags };
}

const { positional, flags } = parseArguments(process.argv.slice(2));
const inputPath = positional[0];
if (!inputPath) {
  console.error('Usage: render-cli.js <infographic_*.json> [--output directory] [--colorway "Flame Blue|Verdigris|Champagne"] [--lang EN|中文]');
  process.exitCode = 1;
} else {
  renderInfographicPacket(path.resolve(inputPath), {
    outputDirectory: flags.output ? path.resolve(flags.output) : undefined,
    colorway: flags.colorway,
    defaultLang: flags.lang
  }).then(({ supportJsPath, rendered, failures }) => {
    console.log(JSON.stringify({
      supportJsPath,
      rendered: rendered.map((r) => r.outputPath),
      failures
    }, null, 2));
    if (failures.length > 0) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
