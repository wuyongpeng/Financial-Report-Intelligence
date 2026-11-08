import type { TransactionSql } from 'postgres';
import type { HeadlineMetricName } from './crawl-display';
import { getDb } from './db';
import {
  buildOverviewRows,
  OVERVIEW_METRICS,
  type OverviewDbMetric,
  type OverviewIssue,
  type OverviewReview,
  type OverviewRow,
  type OverviewSummary,
} from './metrics-overview';

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

export async function loadMetricsOverview(db: ReturnType<typeof getDb> | TransactionSql = getDb()): Promise<{
  rows: OverviewRow[];
  summary: OverviewSummary;
  periods: string[];
}> {
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
  for (const row of reviewRows) {
    if (row.status !== 'acked' && row.status !== 'flagged') continue;
    reviews.push({
      announcementId: row.announcement_id,
      status: row.status,
      note: row.note,
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
  const periods = [...new Set(rows.map((row) => row.period))]
    .sort((a, b) => b.localeCompare(a));
  return { rows, summary, periods };
}

/** Rule hits on this filing at write time. Empty when the announcement has no overview row. */
export async function overviewIssuesForAnnouncement(
  db: ReturnType<typeof getDb> | TransactionSql,
  announcementId: string,
): Promise<OverviewIssue[]> {
  const { rows } = await loadMetricsOverview(db);
  return rows.find((row) => row.announcementId === announcementId)?.issues ?? [];
}
