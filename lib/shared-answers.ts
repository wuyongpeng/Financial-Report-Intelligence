import { randomBytes } from 'node:crypto';
import { ensureBackendSchema } from './backend-schema';
import { getDb } from './db';
import type { Evidence } from './conversations';

export type SharedAnswer = {
  id: string;
  ownerKey: string;
  conversationId: string | null;
  reportId: string | null;
  code: string | null;
  companyName: string | null;
  period: string | null;
  question: string;
  answer: string;
  evidence: Evidence[];
  createdAt: string;
};

function asShare(row: Record<string, unknown>): SharedAnswer {
  return {
    id: String(row.id),
    ownerKey: String(row.owner_key),
    conversationId: row.conversation_id ? String(row.conversation_id) : null,
    reportId: row.report_id ? String(row.report_id) : null,
    code: row.code ? String(row.code) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    period: row.period ? String(row.period) : null,
    question: String(row.question),
    answer: String(row.answer),
    evidence: Array.isArray(row.evidence) ? row.evidence as Evidence[] : [],
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  };
}

export function newShareId() {
  return randomBytes(8).toString('hex');
}

export async function createSharedAnswer(input: {
  ownerKey: string;
  conversationId?: string | null;
  reportId?: string | null;
  code?: string | null;
  companyName?: string | null;
  period?: string | null;
  question: string;
  answer: string;
  evidence?: Evidence[];
}) {
  await ensureBackendSchema();
  const id = newShareId();
  const [row] = await getDb()`
    INSERT INTO shared_answers (
      id, owner_key, conversation_id, report_id, code, company_name, period, question, answer, evidence
    ) VALUES (
      ${id}, ${input.ownerKey}, ${input.conversationId ?? null}, ${input.reportId ?? null},
      ${input.code ?? null}, ${input.companyName ?? null}, ${input.period ?? null},
      ${input.question.trim()}, ${input.answer}, ${getDb().json(input.evidence ?? [])}
    ) RETURNING *
  `;
  return asShare(row as Record<string, unknown>);
}

export async function getSharedAnswer(id: string) {
  await ensureBackendSchema();
  if (!/^[a-z0-9]{10,32}$/i.test(id)) return null;
  const [row] = await getDb()`SELECT * FROM shared_answers WHERE id=${id} LIMIT 1`;
  return row ? asShare(row as Record<string, unknown>) : null;
}

export async function deleteUserShares(ownerKey: string) {
  await ensureBackendSchema();
  await getDb()`DELETE FROM shared_answers WHERE owner_key=${ownerKey}`;
}
