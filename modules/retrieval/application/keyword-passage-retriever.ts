import { rankEvidence, relevance } from '@/lib/chat-evidence';
import type { RetrievalChunk } from '../domain/retrieval';

export type PassageCandidate = { page: number; content: string };

export interface PassageRetriever {
  retrieve(input: {
    query: string;
    chunks: RetrievalChunk[];
    metricPages: number[];
    limit: number;
  }): PassageCandidate[];
  excerpt(query: string, content: string, length?: number): string;
}

export class KeywordPassageRetriever implements PassageRetriever {
  retrieve(input: { query: string; chunks: RetrievalChunk[]; metricPages: number[]; limit: number }) {
    return rankEvidence(
      input.query,
      input.chunks.map(chunk => ({ page: chunk.page, content: chunk.content })),
      input.metricPages,
    ).slice(0, input.limit);
  }

  excerpt(query: string, content: string, length = 1600) {
    if (content.length <= length) return content;
    const spans: Array<{ start: number; text: string; score: number }> = [];
    for (let start = 0; start < content.length; start += Math.floor(length / 2)) {
      const text = content.slice(start, start + length);
      spans.push({ start, text, score: relevance(query, text) });
    }
    return spans.sort((a, b) => b.score - a.score || a.start - b.start)[0].text;
  }
}
