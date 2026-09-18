import { appUserRole } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { allMetricNames } from '@/lib/detail-model';

export const dynamic = 'force-dynamic';

const verdicts = ['correct', 'wrong'] as const;

function emptyFeedback() {
  return { mine: {}, disputed: [] as string[] };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureBackendSchema();
    const { id } = await context.params;
    const body = await request.json().catch(() => ({})) as { metric?: string; verdict?: string; note?: string };
    if (!allMetricNames.includes(body.metric as never)) return Response.json({ error: 'metric 不在可核验范围内' }, { status: 400 });
    if (!verdicts.includes(body.verdict as never)) return Response.json({ error: 'verdict 必须为 correct 或 wrong' }, { status: 400 });
    const reporter = appUserRole(request) ?? 'guest';
    const db = getDb();
    const now = new Date().toISOString();
    await db`
      INSERT INTO metric_feedback (announcement_id, metric, verdict, reporter, note, created_at)
      VALUES (${id}, ${body.metric!}, ${body.verdict!}, ${reporter}, ${body.note?.slice(0, 500) ?? null}, ${now})
      ON CONFLICT (announcement_id, metric, reporter)
      DO UPDATE SET verdict=EXCLUDED.verdict, note=EXCLUDED.note, created_at=EXCLUDED.created_at
    `;
    const [tally] = await db<Array<{ correct: number; wrong: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE verdict='correct')::int AS correct,
        COUNT(*) FILTER (WHERE verdict='wrong')::int AS wrong
      FROM metric_feedback WHERE announcement_id=${id} AND metric=${body.metric!}
    `;
    return Response.json({ ok: true, metric: body.metric, verdict: body.verdict, tally }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureBackendSchema();
    const { id } = await context.params;
    const db = getDb();
    const rows = await db<Array<{ metric: string; verdict: string; reporter: string }>>`
      SELECT metric, verdict, reporter FROM metric_feedback WHERE announcement_id=${id}
    `;
    const reporter = appUserRole(request) ?? 'guest';
    return Response.json({
      mine: Object.fromEntries(rows.filter(r => r.reporter === reporter).map(r => [r.metric, r.verdict])),
      disputed: [...new Set(rows.filter(r => r.verdict === 'wrong').map(r => r.metric))],
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[feedback] read failed', error);
    return Response.json(emptyFeedback(), { headers: { 'cache-control': 'no-store' } });
  }
}
