import { requireAdmin, requireAppUser } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const appDenied = requireAppUser(request);
  if (appDenied) return appDenied;
  const denied = requireAdmin(request);
  if (denied) return denied;
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as { action?: string; note?: string };
  if (!['approve', 'reject'].includes(body.action ?? '')) return Response.json({ error: 'action 必须为 approve 或 reject' }, { status: 400 });
  const action = body.action as 'approve' | 'reject';
  const db = getDb();
  const now = new Date().toISOString();
  await db.begin(async (tx) => {
    if (action === 'approve') {
      await tx`UPDATE financial_metrics SET verified=true WHERE announcement_id=${id}`;
      await tx`UPDATE announcements SET status='online', online_at=${now}, updated_at=${now}, parse_error=NULL WHERE id=${id}`;
    } else {
      await tx`UPDATE announcements SET status='review', online_at=NULL, updated_at=${now} WHERE id=${id}`;
    }
    await tx`INSERT INTO review_events (announcement_id, action, reviewer, note, created_at) VALUES (${id}, ${action}, 'admin', ${body.note ?? null}, ${now})`;
  });
  return Response.json({ ok: true, status: action === 'approve' ? 'online' : 'review' });
}
