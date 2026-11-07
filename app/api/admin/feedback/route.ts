import { apiError, ApiError, readObject } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await ensureBackendSchema();
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
    const beforeIdRaw = Number(url.searchParams.get('beforeId') ?? '');
    const beforeId = Number.isFinite(beforeIdRaw) && beforeIdRaw > 0 ? beforeIdRaw : null;
    const includeArchived = url.searchParams.get('includeArchived') === '1';
    const db = getDb();
    const rows = await db<Array<{
      id: number;
      category: string | null;
      message: string;
      contact: string | null;
      page: string | null;
      url: string | null;
      user_agent: string | null;
      handling_status: string | null;
      created_at: string;
    }>>`
      SELECT id, category, message, contact, page, url, user_agent, handling_status, created_at
      FROM user_feedback
      WHERE (${includeArchived} OR handling_status IS DISTINCT FROM 'archived')
        AND (${beforeId}::bigint IS NULL OR id < ${beforeId})
      ORDER BY id DESC
      LIMIT ${limit}
    `;
    return Response.json({ items: rows }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

const HANDLING = new Set(['open', 'in_progress', 'resolved', 'archived']);

export async function PATCH(request: Request) {
  try {
    await ensureBackendSchema();
    const body = await readObject(request);
    const id = Number(body.id);
    const status = typeof body.status === 'string' ? body.status : '';
    if (!Number.isInteger(id) || id <= 0 || !HANDLING.has(status)) {
      throw new ApiError(400, '状态无效');
    }
    const rows = await getDb()`
      UPDATE user_feedback SET handling_status=${status} WHERE id=${id} RETURNING id
    `;
    if (!rows.length) throw new ApiError(404, '反馈不存在');
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
