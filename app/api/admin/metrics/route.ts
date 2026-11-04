import { requireAdmin } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { ensureBackendSchema } from '@/lib/backend-schema';
import type { HeadlineMetricName } from '@/lib/crawl-display';
import { getDb } from '@/lib/db';
import {
  buildOverviewRows,
  OVERVIEW_METRICS,
  type OverviewDbMetric,
  type OverviewReview,
} from '@/lib/metrics-overview';

export const dynamic = 'force-dynamic';

type RawMetricRow = {
  code: string;
  name: string | null;
  title: string | null;
  announcement_id: string | null;
  period: string;
  metric: string;
  value: number;
  unit: string | null;
  source_page: number | null;
  prior_value: number | null;
  yoy_pct: number | null;
};

export async function GET(request: Request) {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    await ensureBackendSchema();
    const db = getDb();

    const raw = await db<RawMetricRow[]>`
      SELECT DISTINCT ON (m.code, m.period, m.metric)
        m.code, c.name, a.title, m.announcement_id, m.period, m.metric, m.value, m.unit,
        m.source_page, m.prior_value, m.yoy_pct
      FROM financial_metrics m
      LEFT JOIN companies c ON c.code = m.code
      LEFT JOIN announcements a ON a.id = m.announcement_id
      WHERE m.metric IN ${db(OVERVIEW_METRICS)}
      ORDER BY m.code, m.period, m.metric, m.confidence DESC NULLS LAST, m.created_at DESC NULLS LAST
    `;

    const reviewRows = await db<Array<{
      announcement_id: string;
      status: string;
      note: string | null;
    }>>`
      SELECT announcement_id, status, note FROM metrics_overview_reviews
    `;
    const reviews: OverviewReview[] = [];
    for (const r of reviewRows) {
      if (r.status !== 'acked' && r.status !== 'flagged') continue;
      reviews.push({
        announcementId: r.announcement_id,
        status: r.status,
        note: r.note,
      });
    }

    const normalized: OverviewDbMetric[] = [];
    for (const row of raw) {
      if (!OVERVIEW_METRICS.includes(row.metric as HeadlineMetricName)) continue;
      normalized.push({
        code: row.code,
        name: row.name,
        title: row.title,
        announcement_id: row.announcement_id,
        period: row.period,
        metric: row.metric as HeadlineMetricName,
        value: Number(row.value),
        unit: row.unit,
        source_page: row.source_page == null ? null : Number(row.source_page),
        prior_value: row.prior_value == null ? null : Number(row.prior_value),
        yoy_pct: row.yoy_pct == null ? null : Number(row.yoy_pct),
      });
    }

    const { rows, summary } = buildOverviewRows(normalized, { reviews });
    const periods = [...new Set(rows.map((r) => r.period))]
      .sort((a, b) => b.localeCompare(a));

    return Response.json({
      note: '一眼看四核（值·同比·页码）。异常=规则检出或人工标异；错抓可删；真暴增/已修好点审核通过；用户反馈可标记异常。',
      summary,
      periods,
      rows,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
