import { cleanText, nowIso, sha256 } from './utils.js';

const EVIDENCE_TYPES = new Set(['direct', 'context', 'comparison']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

export function createEvidenceItem(input, documents, { clock } = {}) {
  const document = documents.find((entry) => entry.id === input.documentId);
  if (!document) throw new Error(`Unknown evidence document "${input.documentId}"`);
  if (document.failureReason) throw new Error('Evidence cannot reference a failed document');

  const statement = cleanText(input.statement);
  const excerpt = cleanText(input.excerpt);
  const normalizedBody = cleanText(document.cleanedText);
  if (!statement) throw new Error('Evidence statement is required');
  if (!excerpt) throw new Error('Evidence excerpt is required');
  if (!normalizedBody.includes(excerpt)) throw new Error('Evidence excerpt was not found in the fetched document');

  const evidenceType = input.evidenceType || 'direct';
  const confidence = input.confidence || 'medium';
  if (!EVIDENCE_TYPES.has(evidenceType)) throw new Error(`Invalid evidence type "${evidenceType}"`);
  if (!CONFIDENCE_LEVELS.has(confidence)) throw new Error(`Invalid confidence "${confidence}"`);

  return {
    id: sha256(`${document.id}:${statement}:${excerpt}`),
    statement,
    excerpt,
    documentId: document.id,
    sourceUrl: document.finalUrl,
    sourceTitle: document.title,
    publisher: document.publisher,
    publishedAt: document.publishedAt,
    retrievedAt: document.retrievedAt || nowIso(clock),
    evidenceType,
    confidence
  };
}
