import type { MemoryMessage } from './conversations';
import { getDb } from './db';
import { healFilingLabels } from './period-heal';
import { retrieveContext } from '@/modules/retrieval/application/retrieve-context';
import { KeywordPassageRetriever } from '@/modules/retrieval/application/keyword-passage-retriever';
import {
  mentionedCompanyCodes,
  retrievalQuestion,
  historyForModel,
  isAnaphoricFollowUp,
  isDisposablePriorQuestion,
  wantsCompanyHistory,
  wantsEvaluativeJudgement,
  wantsPeerCompare,
} from '@/modules/retrieval/application/question-planner';
import { PostgresRetrievalRepository } from '@/modules/retrieval/infrastructure/postgres-retrieval-repository';
import type { RetrievalContext } from '@/modules/retrieval/domain/retrieval';

/** Compatibility name retained for answer generation and existing client contracts. */
export type RagContext = RetrievalContext;

export {
  mentionedCompanyCodes,
  retrievalQuestion,
  historyForModel,
  isAnaphoricFollowUp,
  isDisposablePriorQuestion,
  wantsCompanyHistory,
  wantsEvaluativeJudgement,
  wantsPeerCompare,
};

const passageRetriever = new KeywordPassageRetriever();

/** Compatibility helper retained while callers migrate to PassageRetriever. */
export function excerpt(query: string, content: string, length = 1600) {
  return passageRetriever.excerpt(query, content, length);
}

/** Composition root for the retrieval module. */
export async function loadRagContext(
  reportId: string,
  question: string,
  history: MemoryMessage[],
  summary = false,
): Promise<RagContext> {
  const db = getDb();
  return retrieveContext({
    reportId,
    question,
    history,
    summary,
    repository: new PostgresRetrievalRepository(db),
    passageRetriever,
    observeTarget: report => healFilingLabels(db, [{
      id: report.id,
      title: report.title,
      published_at: report.publishedAt,
    }]),
  });
}
