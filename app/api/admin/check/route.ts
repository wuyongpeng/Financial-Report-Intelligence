import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { loadCheckSnapshot } from '@/lib/metrics-check-server';
import { applyCheckReviews, summarizeCheckReviews, parseCheckReviewInput, findCheckReviewTarget, type CheckReview, type CheckProgress, applyCheckProgress, summarizeCheckProgress, parseCheckProgressInput } from '@/lib/metrics-check-review';

export const dynamic = 'force-dynamic';

/** Open ops console; independent from metrics overview and deletion authorization. */
export async function GET() {
  try {
    await ensureBackendSchema();
    const db = getDb();
    const snapshot = await loadCheckSnapshot(db);
    const reviews = await db<CheckReview[]>`SELECT code, period, metric, fingerprint, status FROM metrics_check_reviews`;
    const progress = await db<CheckProgress[]>`SELECT DISTINCT ON (code, period, metric)
      code, period, metric, fingerprint, status, note, updated_at::text AS "updatedAt"
      FROM metrics_check_progress ORDER BY code, period, metric, updated_at DESC, id DESC`;
    const cells = applyCheckProgress(applyCheckReviews(snapshot.cells, reviews), progress);
    return Response.json({ ...snapshot, cells, reviewSummary: summarizeCheckReviews(cells), progressSummary: summarizeCheckProgress(cells) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: '请求体无效' }, { status: 400 }); }
  const progress = parseCheckProgressInput(body);
  const review = progress ? null : parseCheckReviewInput(body);
  const input = progress ?? review;
  if (!input) return Response.json({ error: '核对处理参数无效' }, { status: 400 });
  try {
    await ensureBackendSchema();
    const result = await getDb().begin('isolation level repeatable read', async tx => {
      const snapshot = await loadCheckSnapshot(tx);
      const target = findCheckReviewTarget(snapshot.cells, input);
      if (!target.ok) return target;
      if (progress) {
        await tx`INSERT INTO metrics_check_progress (code, period, metric, fingerprint, status, note, updated_at)
          VALUES (${progress.code}, ${progress.period}, ${progress.metric}, ${progress.fingerprint}, ${progress.status}, ${progress.note}, NOW())`;
      } else await tx`INSERT INTO metrics_check_reviews (code, period, metric, fingerprint, status, updated_at)
        VALUES (${input.code}, ${input.period}, ${input.metric}, ${input.fingerprint}, ${input.status}, NOW())
        ON CONFLICT (code, period, metric) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,
          status=EXCLUDED.status, updated_at=NOW()`;
      return { ok: true as const };
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true, status: input.status }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
