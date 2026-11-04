import { requireAdmin } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Mark a metrics overview row as human-flagged (用户反馈 / 人工发现不一致).
 * Clears acked state (mutual exclusive). Always appears in异常筛选 until审核通过.
 * Optional short note (reason / feedback source). Admin session only.
 */
export async function POST(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  let body: {
    announcementId?: unknown;
    code?: unknown;
    period?: unknown;
    note?: unknown;
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

  try {
    await ensureBackendSchema();
    const db = getDb();

    const rows = await db<Array<{ id: string }>>`
      SELECT id FROM announcements WHERE id=${announcementId} LIMIT 1
    `;
    if (!rows[0]) {
      return Response.json({ error: '公告不存在' }, { status: 404 });
    }

    const note = typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : null;

    await db`
      INSERT INTO metrics_overview_reviews (announcement_id, code, period, status, note, updated_at)
      VALUES (${announcementId}, ${code}, ${period}, 'flagged', ${note}, NOW())
      ON CONFLICT (announcement_id) DO UPDATE
      SET code=EXCLUDED.code,
          period=EXCLUDED.period,
          status='flagged',
          note=COALESCE(EXCLUDED.note, metrics_overview_reviews.note),
          updated_at=NOW()
    `;

    // Flagged supersedes ack — drop legacy ack row so old readers don't treat as acked.
    await db`DELETE FROM metrics_overview_acks WHERE announcement_id=${announcementId}`;

    return Response.json({
      ok: true,
      announcementId,
      code,
      period,
      status: 'flagged',
      note: `已标记异常 ${code} ${period}`,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
