import { randomUUID } from 'node:crypto';
import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { ApiError } from './api';

export type Evidence = { id: string; reportId: string; companyName: string; period: string; page: number; quote: string; metric?: string };
export type StoredMessage = { id: string; request_id: string; role: 'user' | 'assistant'; content: string; status: string; evidence: Evidence[]; mode: string | null };
export type MemoryMessage = { role: 'user' | 'assistant'; content: string };
export type AnswerResult = { answer: string; mode: string; evidence: Evidence[]; status: 'complete' | 'interrupted' | 'failed'; durationMs: number; warnings?: string[] };

export function boundedMemory(messages: MemoryMessage[]) {
  // Whole turns, newest first. Assistant messages are continuity only, never
  // financial evidence; the prompt explicitly requires fresh source retrieval.
  const out: MemoryMessage[] = [];
  let size = 0;
  for (let i = messages.length - 1; i >= 1 && out.length < 12; i -= 2) {
    const user = messages[i - 1], assistant = messages[i];
    if (user.role !== 'user' || assistant.role !== 'assistant') continue;
    const pair = [{ role: 'user' as const, content: user.content.slice(0, 2000) }, { role: 'assistant' as const, content: assistant.content.slice(0, 3000) }];
    const length = pair.reduce((n, m) => n + m.content.length, 0);
    if (size + length > 12_000) break;
    out.unshift(...pair); size += length;
  }
  return out;
}

export async function createConversation(owner: string, reportId: string) {
  await ensureBackendSchema();
  const db = getDb();
  const id = randomUUID();
  const [conversation] = await db`
    INSERT INTO chat_conversations(id, owner_key, report_id, title)
    SELECT ${id}, ${owner}, id, LEFT(company_name || ' · ' || title, 120) FROM announcements WHERE id=${reportId}
    RETURNING id, report_id, title, created_at, updated_at
  `;
  if (!conversation) throw new ApiError(404, '报告不存在');
  return conversation;
}

export async function listConversations(owner: string, reportId: string | null) {
  await ensureBackendSchema();
  return getDb()`SELECT id, report_id, title, created_at, updated_at FROM chat_conversations
    WHERE owner_key=${owner} AND (${reportId}::text IS NULL OR report_id=${reportId}) ORDER BY updated_at DESC LIMIT 50`;
}

export async function readConversation(owner: string, id: string) {
  await ensureBackendSchema();
  const db = getDb();
  const [conversation] = await db`SELECT id, report_id, title, created_at, updated_at FROM chat_conversations WHERE id=${id} AND owner_key=${owner}`;
  if (!conversation) throw new ApiError(404, '会话不存在');
  const messages = await db<StoredMessage[]>`SELECT id::text, request_id, role, content, status, evidence, mode FROM (
    SELECT m.* FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
    WHERE c.id=${id} AND c.owner_key=${owner} ORDER BY m.id DESC LIMIT 100
  ) recent ORDER BY recent.id`;
  return { conversation, messages };
}

export async function deleteConversation(owner: string, id: string) {
  await ensureBackendSchema();
  const rows = await getDb()`DELETE FROM chat_conversations WHERE id=${id} AND owner_key=${owner} RETURNING id`;
  if (!rows.length) throw new ApiError(404, '会话不存在');
}

export async function beginTurn(owner: string, conversationId: string, reportId: string, requestId: string, question: string) {
  await ensureBackendSchema();
  const db = getDb();
  return db.begin(async tx => {
    const [conversation] = await tx<Array<{ report_id: string; busy: boolean }>>`
      SELECT report_id, locked_until>NOW() AS busy FROM chat_conversations
      WHERE id=${conversationId} AND owner_key=${owner} FOR UPDATE
    `;
    if (!conversation) throw new ApiError(404, '会话不存在');
    if (conversation.report_id !== reportId) throw new ApiError(409, '会话绑定了另一份报告，请为当前报告新建会话');
    const [existing] = await tx<Array<{ content: string; status: string; evidence: Evidence[]; mode: string; duration_ms: number; question: string }>>`
      SELECT a.content, a.status, a.evidence, a.mode, a.duration_ms, u.content AS question FROM chat_messages a
      JOIN chat_messages u ON u.conversation_id=a.conversation_id AND u.request_id=a.request_id AND u.role='user'
      WHERE a.conversation_id=${conversationId} AND a.request_id=${requestId} AND a.role='assistant'
    `;
    if (existing && existing.question !== question) throw new ApiError(409, 'requestId 已被另一条问题使用');
    if (existing?.status === 'complete') return { history: [], replay: { answer: existing.content, evidence: existing.evidence, mode: existing.mode, status: 'complete' as const, durationMs: existing.duration_ms } };
    if (conversation.busy) throw new ApiError(409, '该会话正在回答，请等待完成后再提问');
    await tx`UPDATE chat_messages SET status='interrupted' WHERE conversation_id=${conversationId} AND status='pending'`;
    await tx`UPDATE chat_conversations SET active_request_id=${requestId}, locked_until=NOW()+INTERVAL '3 minutes', updated_at=NOW() WHERE id=${conversationId}`;
    await tx`INSERT INTO chat_messages(conversation_id, request_id, role, content, status)
      VALUES (${conversationId},${requestId},'user',${question},'complete') ON CONFLICT(conversation_id, request_id, role) DO NOTHING`;
    await tx`INSERT INTO chat_messages(conversation_id, request_id, role, content, status)
      VALUES (${conversationId},${requestId},'assistant','','pending') ON CONFLICT(conversation_id, request_id, role)
      DO UPDATE SET content='', status='pending', evidence='[]'::jsonb, mode=NULL, duration_ms=NULL`;
    const previous = await tx<Array<{ question: string; answer: string }>>`
      SELECT u.content AS question, a.content AS answer FROM chat_messages a
      JOIN chat_messages u ON u.conversation_id=a.conversation_id AND u.request_id=a.request_id AND u.role='user'
      WHERE a.conversation_id=${conversationId} AND a.role='assistant' AND a.status='complete' AND a.request_id<>${requestId}
      ORDER BY a.id DESC LIMIT 6
    `;
    const history = boundedMemory([...previous].reverse().flatMap(m => [{ role: 'user' as const, content: m.question }, { role: 'assistant' as const, content: m.answer }]));
    return { history, replay: null };
  });
}

export async function finishTurn(owner: string, conversationId: string, requestId: string, result: AnswerResult) {
  await getDb().begin(async tx => {
    const lease = await tx`UPDATE chat_conversations SET active_request_id=NULL, locked_until=NULL, updated_at=NOW()
      WHERE id=${conversationId} AND owner_key=${owner} AND active_request_id=${requestId} RETURNING id`;
    if (!lease.length) return;
    await tx`UPDATE chat_messages SET content=${result.answer}, status=${result.status}, mode=${result.mode},
      evidence=${tx.json(result.evidence)}, duration_ms=${result.durationMs}
      WHERE conversation_id=${conversationId} AND request_id=${requestId} AND role='assistant'`;
  });
}
