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
      )
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map((row) => {
    const created = row.created_at as unknown;
    return {
      ...row,
      id: Number(row.id),
      created_at: created instanceof Date ? created.toISOString() : String(created),
      detail: (row.detail && typeof row.detail === 'object') ? row.detail as Record<string, unknown> : {},
    };
  });
}
