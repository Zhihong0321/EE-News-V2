import { randomUUID } from 'node:crypto';
import { createEvidenceItem } from './evidence-ledger.js';
import { saveResearchPacket } from './packet-store.js';
import { canonicalizeUrl, nowIso } from './utils.js';

export class ResearchSession {
  constructor({
    question,
    searchWeb,
    fetchPage,
    budgets = {},
    clock = () => new Date(),
    sessionId = randomUUID()
  }) {
    if (!question?.trim()) throw new Error('A research question is required');
    this.searchWeb = searchWeb;
    this.fetchPage = fetchPage;
    this.clock = clock;
    this.startedAtMs = clock().getTime();
    this.packet = {
      schemaVersion: 1,
      sessionId,
      question: question.trim(),
      status: 'active',
      startedAt: nowIso(clock),
      completedAt: null,
      budgets: {
        maxRequests: budgets.maxRequests || 20,
        maxDocuments: budgets.maxDocuments || 10,
        maxElapsedMs: budgets.maxElapsedMs || 300000
      },
      queries: [],
      searchResults: [],
      documents: [],
      evidence: [],
      failures: [],
      events: []
    };
  }

  elapsedMs() {
    return this.clock().getTime() - this.startedAtMs;
  }

  requestCount() {
    return this.packet.events.filter((event) => event.type === 'search' || event.type === 'fetch').length;
  }

  assertBudget(kind) {
    if (this.elapsedMs() >= this.packet.budgets.maxElapsedMs) throw new Error('Research session elapsed-time budget exhausted');
    if (this.requestCount() >= this.packet.budgets.maxRequests) throw new Error('Research session request budget exhausted');
    if (kind === 'fetch' && this.packet.documents.length >= this.packet.budgets.maxDocuments) {
      throw new Error('Research session document budget exhausted');
    }
  }

  event(type, details = {}) {
    this.packet.events.push({
      sequence: this.packet.events.length + 1,
      type,
      at: nowIso(this.clock),
      elapsedMs: this.elapsedMs(),
      ...details
    });
  }

  async search(query, options) {
    this.assertBudget('search');
    const result = await this.searchWeb(query, options);
    this.packet.queries.push({ query: result.query, provider: result.provider, searchedAt: result.searchedAt });
    this.event('search', { query: result.query, provider: result.provider, resultCount: result.results.length });

    const existing = new Set(this.packet.searchResults.map((entry) => entry.url));
    for (const entry of result.results) {
      if (existing.has(entry.url)) {
        this.event('duplicate-url', { url: entry.url, query: result.query });
        continue;
      }
      existing.add(entry.url);
      this.packet.searchResults.push(entry);
    }
    return result;
  }

  async fetch(url, options) {
    this.assertBudget('fetch');
    const canonicalUrl = canonicalizeUrl(url);
    const existing = this.packet.documents.find((document) => canonicalizeUrl(document.requestedUrl) === canonicalUrl);
    if (existing) {
      this.event('duplicate-url', { url: canonicalUrl, documentId: existing.id });
      return existing;
    }

    const document = await this.fetchPage(canonicalUrl, options);
    this.packet.documents.push(document);
    this.event('fetch', {
      url: canonicalUrl,
      documentId: document.id,
      fetcherUsed: document.fetcherUsed,
      success: !document.failureReason
    });
    if (document.failureReason) {
      this.packet.failures.push({ url: canonicalUrl, reason: document.failureReason, statusCode: document.statusCode });
    }
    return document;
  }

  addEvidence(input) {
    const item = createEvidenceItem(input, this.packet.documents, { clock: this.clock });
    if (!this.packet.evidence.some((entry) => entry.id === item.id)) this.packet.evidence.push(item);
    this.event('evidence', { evidenceId: item.id, documentId: item.documentId });
    return item;
  }

  complete({ sufficient = this.packet.documents.some((document) => !document.failureReason), reason = null } = {}) {
    this.packet.status = sufficient ? 'complete' : 'insufficient-evidence';
    this.packet.completedAt = nowIso(this.clock);
    if (reason) this.packet.failures.push({ reason });
    this.event('complete', { status: this.packet.status });
    return this.packet;
  }

  async save(outputDirectory) {
    return saveResearchPacket(this.packet, outputDirectory);
  }
}
