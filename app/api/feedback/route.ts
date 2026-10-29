import { apiError, readObject } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { parseFeedbackInput } from '@/lib/feedback-input';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await readObject(request);
    const parsed = parseFeedbackInput(body, request.headers.get('user-agent'));
    await ensureBackendSchema();
    const db = getDb();
    const [row] = await db<Array<{ id: number; created_at: string }>>`
      INSERT INTO user_feedback (message, page, url, user_agent)
      VALUES (${parsed.message}, ${parsed.page}, ${parsed.url}, ${parsed.userAgent})
      RETURNING id, created_at
    `;
    return Response.json({ ok: true, id: row.id, createdAt: row.created_at }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
