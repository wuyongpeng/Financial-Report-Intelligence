import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { REVIEW_REASON_LABEL, parseReviewReason } from '@/lib/metrics-review-log';
import { writeOverviewReview } from '@/lib/metrics-review-record';

export const dynamic = 'force-dynamic';

/**
 * Mark a metrics overview row as human-acked (true surge / fixed after flag).
 * Clears flagged state (mutual exclusive). Hides from异常筛选.
 * Also appends one event with the optional reason and the rule hits at this moment.
 */
export async function POST(request: Request) {
  let body: {
    announcementId?: unknown;
    code?: unknown;
    period?: unknown;
    note?: unknown;
    reason?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  const announcementId = typeof body.announcementId === 'string' ? body.announcementId.trim() : '';
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const period = typeof body.period === 'string' ? body.period.trim() : '';
  if (!announcementId) {
    return Response.json({ error: '需要 announcementId' }, { status: 400 });
  }
  if (!code || !period) {
    return Response.json({ error: '需要 code 与 period' }, { status: 400 });
  }
  const reason = parseReviewReason(body.reason);
  if (reason === 'invalid') {
    return Response.json({ error: '原因无效' }, { status: 400 });
  }

  try {
    await ensureBackendSchema();
    const db = getDb();

    const rows = await db<Array<{ id: string; code: string }>>`
      SELECT id, code
      FROM announcements
      WHERE id=${announcementId}
      LIMIT 1
    `;
    if (!rows[0]) {
      return Response.json({ error: '公告不存在' }, { status: 404 });
    }

    const note = typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : null;
    const written = await writeOverviewReview(db, {
      announcementId,
      code,
      period,
      action: 'acked',
      reason,
      note,
    });
    const reasonLabel = reason ? REVIEW_REASON_LABEL[reason] : '';

    return Response.json({
      ok: true,
      announcementId,
      code,
      period,
      status: 'acked',
      reason,
      issues: written.issues,
      note: reasonLabel
        ? `已审核通过 ${code} ${period}（${reasonLabel}）`
        : `已审核通过 ${code} ${period}`,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
