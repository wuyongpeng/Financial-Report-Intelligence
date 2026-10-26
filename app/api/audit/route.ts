import { ensureConversationOwner } from '@/lib/auth';
import { apiError, ApiError, readObject } from '@/lib/api';
import { recordClientAudit, type AuditEventType } from '@/lib/client-audit';

export const dynamic = 'force-dynamic';

const EVENT_TYPES = new Set<AuditEventType>(['visit', 'ask', 'answer_feedback']);

function optionalText(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new ApiError(400, '字段类型错误');
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new ApiError(400, `字段过长（最多 ${max} 字）`);
  return text;
}

function optionalStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new ApiError(400, 'tags 必须是数组');
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLen));
}

/** Anonymous-friendly audit sink: visit / ask (client echo) / answer_feedback. */
export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const eventType = typeof body.eventType === 'string' ? body.eventType : '';
    if (!EVENT_TYPES.has(eventType as AuditEventType)) {
      throw new ApiError(400, 'eventType 无效');
    }
    const guest = ensureConversationOwner(request);
    const reportId = optionalText(body.reportId, 120);
    const companyCode = optionalText(body.companyCode, 16);
    const conversationId = optionalText(body.conversationId, 36);
    const requestId = optionalText(body.requestId, 36);
    const question = optionalText(body.question, 4000);
    const path = optionalText(body.path, 500);
    const note = optionalText(body.note, 200);
    const vote = optionalText(body.vote, 8);
    const tags = optionalStringList(body.tags, 12, 40);
    const browser = (body.browser && typeof body.browser === 'object' && !Array.isArray(body.browser))
      ? body.browser as Record<string, unknown>
      : {};

    const extra = (body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail))
      ? body.detail as Record<string, unknown>
      : {};
    const detail: Record<string, unknown> = { ...extra, browser };
    if (tags.length) detail.tags = tags;
    if (note) detail.note = note;
    if (vote === 'up' || vote === 'down') detail.vote = vote;

    await recordClientAudit({
      eventType: eventType as AuditEventType,
      ownerKey: guest.owner,
      reportId,
      companyCode,
      conversationId,
      requestId,
      question,
      path: path ?? (typeof body.path === 'string' ? body.path : null),
      detail,
    }, request);

    const headers = new Headers({ 'cache-control': 'no-store' });
    if (guest.setCookie) headers.append('set-cookie', guest.setCookie);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return apiError(error);
  }
}
