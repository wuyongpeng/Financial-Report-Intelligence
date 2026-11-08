import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import type { AuditEventType } from './client-audit';

export type ClientAuditRow = {
  id: number;
  event_type: AuditEventType;
  owner_key: string | null;
  ip: string | null;
  user_agent: string | null;
  accept_language: string | null;
  path: string | null;
  referer: string | null;
  report_id: string | null;
  company_code: string | null;
  conversation_id: string | null;
  request_id: string | null;
  question: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type ListClientAuditQuery = {
  eventType?: AuditEventType | null;
  companyCode?: string | null;
  q?: string | null;
  limit: number;
  beforeId?: number | null;
};

export async function listClientAudit(query: ListClientAuditQuery): Promise<ClientAuditRow[]> {
  await ensureBackendSchema();
  const db = getDb();
  const limit = Math.min(Math.max(query.limit, 1), 200);
  const eventType = query.eventType ?? null;
  const companyCode = query.companyCode?.trim() || null;
  const q = query.q?.trim() || null;
  const beforeId = query.beforeId ?? null;
  const like = q ? `%${q}%` : null;

  const rows = await db<ClientAuditRow[]>`
    SELECT
      id, event_type, owner_key, ip, user_agent, accept_language, path, referer,
      report_id, company_code, conversation_id::text AS conversation_id,
      request_id::text AS request_id, question, detail, created_at
    FROM client_audit_events
    WHERE (${eventType}::text IS NULL OR event_type = ${eventType})
      AND (${companyCode}::text IS NULL OR company_code = ${companyCode})
      AND (${beforeId}::bigint IS NULL OR id < ${beforeId})
      AND (
        ${like}::text IS NULL
        OR question ILIKE ${like}
        OR ip ILIKE ${like}
        OR user_agent ILIKE ${like}
        OR owner_key ILIKE ${like}
        OR company_code ILIKE ${like}
        OR path ILIKE ${like}
        OR referer ILIKE ${like}
        OR report_id ILIKE ${like}
        OR conversation_id::text ILIKE ${like}
        OR request_id::text ILIKE ${like}
        OR event_type ILIKE ${like}
        OR detail::text ILIKE ${like}
      )
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map(normalizeAuditRow);
}

export type AuditTurn = {
  prompt: string | null;
  reply: string | null;
  durationMs: number | null;
  status: string | null;
  mode: string | null;
};

export type ClientAuditDetail = {
  event: ClientAuditRow;
  turn: AuditTurn;
};

function normalizeAuditRow(row: ClientAuditRow): ClientAuditRow {
  const created = row.created_at as unknown;
  return {
    ...row,
    id: Number(row.id),
    created_at: created instanceof Date ? created.toISOString() : String(created),
    detail: (row.detail && typeof row.detail === 'object') ? row.detail as Record<string, unknown> : {},
  };
}

export async function readClientAuditDetail(id: number): Promise<ClientAuditDetail | null> {
  await ensureBackendSchema();
  const rows = await getDb()<Array<ClientAuditRow & {
    user_prompt: string | null;
    assistant_reply: string | null;
    duration_ms: number | null;
    answer_status: string | null;
    answer_mode: string | null;
  }>>`
    SELECT
      e.id, e.event_type, e.owner_key, e.ip, e.user_agent, e.accept_language, e.path, e.referer,
      e.report_id, e.company_code, e.conversation_id::text AS conversation_id,
      e.request_id::text AS request_id, e.question, e.detail, e.created_at,
      u.content AS user_prompt,
      a.content AS assistant_reply,
      a.duration_ms,
      a.status AS answer_status,
      a.mode AS answer_mode
    FROM client_audit_events e
    LEFT JOIN chat_messages u
      ON e.conversation_id IS NOT NULL
     AND e.request_id IS NOT NULL
     AND u.conversation_id = e.conversation_id
     AND u.request_id = e.request_id
     AND u.role = 'user'
    LEFT JOIN chat_messages a
      ON e.conversation_id IS NOT NULL
     AND e.request_id IS NOT NULL
     AND a.conversation_id = e.conversation_id
     AND a.request_id = e.request_id
     AND a.role = 'assistant'
    WHERE e.id = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const event = normalizeAuditRow(row);
  const duration = row.duration_ms == null ? null : Number(row.duration_ms);
  return {
    event,
    turn: {
      prompt: row.user_prompt?.trim() || event.question,
      reply: row.assistant_reply?.trim() || null,
      durationMs: duration != null && Number.isFinite(duration) ? duration : null,
      status: row.answer_status,
      mode: row.answer_mode,
    },
  };
}

export async function deleteClientAudit(id: number): Promise<boolean> {
  await ensureBackendSchema();
  const rows = await getDb()`DELETE FROM client_audit_events WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
