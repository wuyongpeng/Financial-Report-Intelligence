import { requireAdmin } from '@/lib/auth';
import { apiError, ApiError } from '@/lib/api';
import { listClientAudit, type ClientAuditRow } from '@/lib/list-client-audit';
import type { AuditEventType } from '@/lib/client-audit';

export const dynamic = 'force-dynamic';

const EVENT_TYPES = new Set<AuditEventType>(['visit', 'ask', 'answer_feedback']);

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const eventTypeRaw = url.searchParams.get('eventType');
    const eventType = eventTypeRaw && EVENT_TYPES.has(eventTypeRaw as AuditEventType)
      ? eventTypeRaw as AuditEventType
      : null;
    if (eventTypeRaw && !eventType) throw new ApiError(400, 'eventType 无效');
    const companyCode = url.searchParams.get('companyCode');
    const q = url.searchParams.get('q');
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const beforeIdRaw = url.searchParams.get('beforeId');
    const beforeId = beforeIdRaw ? Number(beforeIdRaw) : null;
    if (beforeIdRaw && (!Number.isFinite(beforeId) || (beforeId as number) < 1)) {
      throw new ApiError(400, 'beforeId 无效');
    }
    const events = await listClientAudit({
      eventType,
      companyCode,
      q,
      limit: Number.isFinite(limit) ? limit : 50,
      beforeId,
    });
    return Response.json({ events } satisfies { events: ClientAuditRow[] }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
