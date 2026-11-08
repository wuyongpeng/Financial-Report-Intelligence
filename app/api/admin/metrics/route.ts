import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import { getDb } from '@/lib/db';
import { loadMetricsOverview } from '@/lib/metrics-overview-server';
import { loadReviewLog } from '@/lib/metrics-review-record';
import type { ReviewReason } from '@/lib/metrics-review-log';

export const dynamic = 'force-dynamic';

/** Open read for operations console; deletion has a separate server-side password gate. */
export async function GET(_request: Request) {
  try {
    await ensureBackendSchema();
    const db = getDb();
    const { rows, summary, periods } = await loadMetricsOverview(db);
    const reviewLog = await loadReviewLog(db);
    const withReason = rows.map((row) => ({
      ...row,
      ackReason: (row.announcementId ? reviewLog.latestAckReason.get(row.announcementId) ?? null : null) as ReviewReason | null,
    }));

    return Response.json({
      note: '异常=规则检出或人工标异。审核通过可记原因（可不选）：真数，或解析错在抽数、页码单位、报告期次，或重新解析后数据一致。每次点击另留一条记录。',
      summary,
      periods,
      rows: withReason,
      reviewLog: {
        summary: reviewLog.summary,
        recent: reviewLog.recent,
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
