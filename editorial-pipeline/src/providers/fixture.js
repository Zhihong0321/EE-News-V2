import fs from 'node:fs/promises';

export function createFixtureProvider(filePath) {
  return {
    id: 'fixture',
    async search(query, { limit = 10 } = {}) {
      const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const results = payload.queries?.[query] || payload.results || [];
      return results.slice(0, limit);
    }
  };
}
