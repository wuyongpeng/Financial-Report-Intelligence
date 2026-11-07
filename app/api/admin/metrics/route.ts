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
  audit_opinion_kind: string | null;
  audit_opinion_type: string | null;
  audit_opinion_label: string | null;
  audit_opinion_page: number | null;
};

/** Open read for operations console; deletion has a separate server-side password gate. */
export async function GET(_request: Request) {
  try {
    await ensureBackendSchema();
    const db = getDb();

    const raw = await db<RawMetricRow[]>`
      SELECT DISTINCT ON (m.code, m.period, m.metric)
        m.code, c.name, a.title, m.announcement_id, m.period, m.metric, m.value, m.unit,
        m.source_page, m.prior_value, m.yoy_pct,
        a.audit_opinion_kind, a.audit_opinion_type, a.audit_opinion_label, a.audit_opinion_page
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
      const kind = row.audit_opinion_kind;
      const auditKind = kind === 'standard' || kind === 'non_standard' || kind === 'none' ? kind : null;
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
        audit_opinion_kind: auditKind,
        audit_opinion_type: row.audit_opinion_type,
        audit_opinion_label: row.audit_opinion_label,
        audit_opinion_page: row.audit_opinion_page == null ? null : Number(row.audit_opinion_page),
      });
    }

    const { rows, summary } = buildOverviewRows(normalized, { reviews });
    const periods = [...new Set(rows.map((r) => r.period))]
      .sort((a, b) => b.localeCompare(a));

    return Response.json({
      note: '一眼看四核与审计意见。异常=规则检出或人工标异；非标可一键过滤；错抓可删；真暴增/已修好点审核通过。',
      summary,
      periods,
      rows,
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
