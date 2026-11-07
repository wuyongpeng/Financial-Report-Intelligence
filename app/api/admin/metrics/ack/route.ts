import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Mark a metrics overview row as human-acked (true surge / fixed after flag).
 * Clears flagged state (mutual exclusive). Hides from异常筛选.
 * Open operations console; deletion remains password-protected in /api/crawl/discard.
 */
export async function POST(request: Request) {

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

    const rows = await db<Array<{ id: string; code: string }>>`
      SELECT id, code
      FROM announcements
      WHERE id=${announcementId}
      LIMIT 1
    `;
    const ann = rows[0];
    if (!ann) {
      return Response.json({ error: '公告不存在' }, { status: 404 });
    }

    const note = typeof body.note === 'string' && body.note.trim()
      ? body.note.trim().slice(0, 200)
      : null;

    await db`
      INSERT INTO metrics_overview_reviews (announcement_id, code, period, status, note, updated_at)
      VALUES (${announcementId}, ${code}, ${period}, 'acked', ${note}, NOW())
      ON CONFLICT (announcement_id) DO UPDATE
      SET code=EXCLUDED.code,
          period=EXCLUDED.period,
          status='acked',
          note=COALESCE(EXCLUDED.note, metrics_overview_reviews.note),
          updated_at=NOW()
    `;

    // Keep legacy acks table in sync for older readers.
    await db`
      INSERT INTO metrics_overview_acks (announcement_id, code, period, note, acked_at)
      VALUES (${announcementId}, ${code}, ${period}, ${note}, NOW())
      ON CONFLICT (announcement_id) DO UPDATE
      SET code=EXCLUDED.code,
          period=EXCLUDED.period,
          note=COALESCE(EXCLUDED.note, metrics_overview_acks.note),
          acked_at=NOW()
    `;

    return Response.json({
      ok: true,
      announcementId,
      code,
      period,
      status: 'acked',
      note: `已审核通过 ${code} ${period}`,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
