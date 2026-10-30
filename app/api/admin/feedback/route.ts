import { requireAdmin } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
    const beforeIdRaw = Number(url.searchParams.get('beforeId') ?? '');
    const beforeId = Number.isFinite(beforeIdRaw) && beforeIdRaw > 0 ? beforeIdRaw : null;
    const db = getDb();
    const rows = beforeId
      ? await db<Array<{
        id: number;
        category: string | null;
        message: string;
        contact: string | null;
        page: string | null;
        url: string | null;
        user_agent: string | null;
        created_at: string;
      }>>`
        SELECT id, category, message, contact, page, url, user_agent, created_at
        FROM user_feedback
        WHERE id < ${beforeId}
        ORDER BY id DESC
        LIMIT ${limit}
      `
      : await db<Array<{
        id: number;
        category: string | null;
        message: string;
        contact: string | null;
        page: string | null;
        url: string | null;
        user_agent: string | null;
        created_at: string;
      }>>`
        SELECT id, category, message, contact, page, url, user_agent, created_at
        FROM user_feedback
        ORDER BY id DESC
        LIMIT ${limit}
      `;
    return Response.json({ items: rows }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
