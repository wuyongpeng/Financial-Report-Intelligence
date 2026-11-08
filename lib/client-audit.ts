import { getDb } from './db';
import { ensureBackendSchema } from './backend-schema';
import { readRequestMeta, type RequestMeta } from './request-meta';

export type AuditEventType = 'visit' | 'ask' | 'answer_feedback';

export type AuditEventInput = {
  eventType: AuditEventType;
  ownerKey?: string | null;
  reportId?: string | null;
  companyCode?: string | null;
  conversationId?: string | null;
  requestId?: string | null;
  question?: string | null;
  path?: string | null;
  detail?: Record<string, unknown>;
  meta?: RequestMeta;
};

/** Best-effort write; never throws to callers (audit must not break product paths). */
export async function recordClientAudit(input: AuditEventInput, request?: Request): Promise<void> {
  try {
    await ensureBackendSchema();
    const meta = input.meta ?? (request ? readRequestMeta(request) : {
      ip: null, userAgent: null, acceptLanguage: null, referer: null,
    });
    const detail = input.detail ?? {};
    const db = getDb();
    await db`
      INSERT INTO client_audit_events (
        event_type, owner_key, ip, user_agent, accept_language, path, referer,
        report_id, company_code, conversation_id, request_id, question, detail
      ) VALUES (
        ${input.eventType},
        ${input.ownerKey ?? null},
        ${meta.ip},
        ${meta.userAgent},
        ${meta.acceptLanguage},
        ${input.path ?? null},
        ${meta.referer},
        ${input.reportId ?? null},
        ${input.companyCode ?? null},
        ${input.conversationId ?? null},
        ${input.requestId ?? null},
        ${input.question ?? null},
        ${db.json(JSON.parse(JSON.stringify(detail)))}
      )
    `;
  } catch (error) {
    console.error('[client-audit] write failed', error instanceof Error ? error.message : error);
  }
}

/** Attach outcome fields after the answer. The insert races the model, so retry once. */
export async function patchAskAudit(requestId: string, patch: Record<string, unknown>): Promise<void> {
  if (!requestId) return;
  try {
    await ensureBackendSchema();
    const db = getDb();
    const write = () => db`
      UPDATE client_audit_events
      SET detail = COALESCE(detail, '{}'::jsonb) || ${db.json(patch)}
      WHERE event_type = 'ask' AND request_id = ${requestId}
      RETURNING id
    `;
    const first = await write();
    if (first.length) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await write();
  } catch (error) {
    console.error('[client-audit] patch failed', error instanceof Error ? error.message : error);
  }
}
