import { authorizeProductWrite } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { discardAnnouncement } from '@/lib/discard-announcement';
import { matchesDiscardPassword } from '@/lib/discard-password';

export const dynamic = 'force-dynamic';

function authorized(request: Request) {
  return authorizeProductWrite(request);
}

/**
 * Soft-discard a wrong capture from the ops crawl table.
 * Marks auto_skipped, clears metrics/verdicts/chunks; keeps the row for audit.
 * Requires ops delete password in body.password (exact "EVA" until real auth).
 */
export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { announcementId?: unknown; id?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求体无效' }, { status: 400 });
  }

  if (!matchesDiscardPassword(body.password)) {
    return Response.json({ error: '删除密码错误' }, { status: 403 });
  }

  const announcementId = typeof body.announcementId === 'string'
    ? body.announcementId.trim()
    : (typeof body.id === 'string' ? body.id.trim() : '');
  if (!announcementId) {
    return Response.json({ error: '需要 announcementId' }, { status: 400 });
  }

  try {
    const result = await discardAnnouncement(announcementId);
    if (!result) {
      return Response.json({ error: '公告不存在' }, { status: 404 });
    }
    return Response.json(
      { ok: true, auth, ...result },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
