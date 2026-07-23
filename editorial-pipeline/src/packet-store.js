import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './utils.js';

export async function saveResearchPacket(packet, outputDirectory) {
  await fs.mkdir(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${packet.sessionId}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  return outputPath;
}

export async function replayResearchPacket(filePath) {
  const packet = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const failures = [];
  for (const document of packet.documents || []) {
    const actualHash = sha256(document.cleanedText || '');
    if (actualHash !== document.contentHash) {
      failures.push({ documentId: document.id, reason: 'content hash mismatch' });
    }
  }
  return {
    valid: failures.length === 0,
    replayedWithoutNetwork: true,
    failures,
    packet
  };
}
