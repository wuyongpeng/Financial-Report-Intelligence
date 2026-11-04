/**
 * Admin /admin/metrics — one-glance parsed core-metric display (value + YoY + page).
 * Pure helpers; no DB. Display rules mirror detail cards (formatMetricValue + resolveYoy).
 */

import {
  formatMetricValue,
  formatYoyBadge,
  resolveYoy,
  type HeadlineMetricName,
  type ResolvedYoy,
} from './crawl-display';

export const OVERVIEW_METRICS: HeadlineMetricName[] = ['revenue', 'net_profit', 'eps', 'roe'];

export const OVERVIEW_METRIC_LABEL: Record<HeadlineMetricName, string> = {
  revenue: '营业收入',
  net_profit: '归母净利润',
  eps: '基本每股收益',
  roe: '净资产收益率',
};

/** |YoY%| at or above this → 离谱 (catches prior-as-yoy bugs like 茅台天文同比). */
export const ABSURD_YOY_ABS_PCT = 500;

export type OverviewIssue = 'missing' | 'no_page' | 'absurd_yoy';

export type OverviewDbMetric = {
  code: string;
  name?: string | null;
  /** announcements.title — full report name for spotting wrong grabs. */
  title?: string | null;
  /** financial_metrics.announcement_id — for discard of wrong grabs. */
  announcement_id?: string | null;
  period: string;
  metric: HeadlineMetricName;
  value: number;
  unit: string | null;
  source_page: number | null;
  prior_value: number | null;
  yoy_pct: number | null;
};

export type OverviewMetricCell = {
  metric: HeadlineMetricName;
  present: boolean;
  valueText: string;
  yoyText: string;
  yoyPct: number | null;
  page: number | null;
  pageText: string;
  issues: OverviewIssue[];
};

export type OverviewReviewStatus = 'acked' | 'flagged';

export type OverviewReview = {
  announcementId: string;
  status: OverviewReviewStatus;
  note?: string | null;
};

export type OverviewRow = {
  code: string;
  name: string;
  /** announcements.title (may be empty if JOIN missed). */
  title: string;
  period: string;
  /** Soft-discard / ack/flag target; null if JOIN/metric had no announcement_id. */
  announcementId: string | null;
  href: string;
  metrics: Record<HeadlineMetricName, OverviewMetricCell>;
  issues: OverviewIssue[];
  /**
   * Visible as异常: human flagged, OR system issues while not acked.
   * Flagged and acked are mutual exclusive.
   */
  abnormal: boolean;
  /** Human-acked true surge / fixed row; hidden from异常筛选. */
  acked: boolean;
  /** Human-flagged (用户反馈/人工发现); always counts as异常 until审核通过. */
  flagged: boolean;
  /** Optional note on the current review (flag reason or ack note). */
  reviewNote: string | null;
};

export type OverviewSummary = {
  rows: number;
  abnormal: number;
  missingCore: number;
  noPage: number;
  absurdYoy: number;
};

function emptyCell(metric: HeadlineMetricName): OverviewMetricCell {
  return {
    metric,
    present: false,
    valueText: '—',
    yoyText: '—',
    yoyPct: null,
    page: null,
    pageText: '—',
    issues: ['missing'],
  };
}

export function isAbsurdYoyPct(pct: number | null | undefined): boolean {
  return pct != null && Number.isFinite(pct) && Math.abs(pct) >= ABSURD_YOY_ABS_PCT;
}

export function buildMetricCell(
  metric: HeadlineMetricName,
  row: OverviewDbMetric | null | undefined,
): OverviewMetricCell {
  if (!row || !Number.isFinite(row.value)) return emptyCell(metric);

  const yoy: ResolvedYoy | undefined = resolveYoy(row.value, {
    disclosedPrior: row.prior_value,
    disclosedYoyPct: row.yoy_pct,
  });
  const yoyText = formatYoyBadge(yoy, 1);
  const yoyPct = yoy && !yoy.naPercent && yoy.pct !== undefined ? yoy.pct : null;
  const page = row.source_page != null && Number.isFinite(row.source_page)
    ? Number(row.source_page)
    : null;

  const issues: OverviewIssue[] = [];
  if (page == null) issues.push('no_page');
  if (isAbsurdYoyPct(yoyPct)) issues.push('absurd_yoy');

  return {
    metric,
    present: true,
    valueText: formatMetricValue(metric, row.value),
    yoyText,
    yoyPct,
    page,
    pageText: page != null ? `P${page}` : '—',
    issues,
  };
}

/** Same period rank as metrics-check (H1 ≡ Q2). */
export function overviewPeriodRank(token: string): number {
  const year = Number(token.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(token) ? 4
    : /H1|Q2/.test(token) ? 2
    : /Q3/.test(token) ? 3
    : /Q1/.test(token) ? 1
    : 0;
  return year * 10 + quarter;
}

export function buildOverviewRows(
  dbRows: OverviewDbMetric[],
  options?: {
    /** Preferred: acked/flagged reviews keyed by announcement id. */
    reviews?: Iterable<OverviewReview>;
    /** @deprecated Prefer reviews; still accepted as acked-only. */
    ackedAnnouncementIds?: Iterable<string>;
  },
): {
  rows: OverviewRow[];
  summary: OverviewSummary;
} {
  const reviewById = new Map<string, OverviewReview>();
  for (const r of options?.reviews ?? []) {
    const id = r.announcementId?.trim();
    if (!id) continue;
    if (r.status !== 'acked' && r.status !== 'flagged') continue;
    reviewById.set(id, {
      announcementId: id,
      status: r.status,
      note: r.note ?? null,
    });
  }
  for (const id of options?.ackedAnnouncementIds ?? []) {
    const trimmed = id.trim();
    if (!trimmed || reviewById.has(trimmed)) continue;
    reviewById.set(trimmed, { announcementId: trimmed, status: 'acked', note: null });
  }
  type Key = string;
  const byKey = new Map<Key, {
    code: string;
    name: string;
    title: string;
    period: string;
    announcementId: string | null;
    metrics: Map<HeadlineMetricName, OverviewDbMetric>;
  }>();

  for (const row of dbRows) {
    if (!OVERVIEW_METRICS.includes(row.metric)) continue;
    if (!row.code || !row.period) continue;
    const key = `${row.code}:${row.period}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = {
        code: row.code,
        name: row.name?.trim() || '',
        title: row.title?.trim() || '',
        period: row.period,
        announcementId: row.announcement_id?.trim() || null,
        metrics: new Map(),
      };
      byKey.set(key, bucket);
    }
    if (row.name?.trim()) bucket.name = row.name.trim();
    if (row.title?.trim() && !bucket.title) bucket.title = row.title.trim();
    if (!bucket.announcementId && row.announcement_id?.trim()) {
      bucket.announcementId = row.announcement_id.trim();
    }
    // Prefer first row; callers should DISTINCT ON already.
    if (!bucket.metrics.has(row.metric)) bucket.metrics.set(row.metric, row);
  }

  const rows: OverviewRow[] = [];
  let missingCore = 0;
  let noPage = 0;
  let absurdYoy = 0;
  let abnormal = 0;

  for (const bucket of byKey.values()) {
    const metrics = {} as Record<HeadlineMetricName, OverviewMetricCell>;
    const issueSet = new Set<OverviewIssue>();
    for (const metric of OVERVIEW_METRICS) {
      const cell = buildMetricCell(metric, bucket.metrics.get(metric));
      metrics[metric] = cell;
      for (const issue of cell.issues) issueSet.add(issue);
    }
    const issues = [...issueSet];
    const review = bucket.announcementId
      ? reviewById.get(bucket.announcementId)
      : undefined;
    const acked = review?.status === 'acked';
    const flagged = review?.status === 'flagged';
    const reviewNote = review?.note?.trim() || null;
    // Flagged always abnormal; system issues abnormal unless acked.
    const isAbnormal = flagged || (issues.length > 0 && !acked);
    if (isAbnormal) abnormal += 1;
    if (isAbnormal && issues.includes('missing')) missingCore += 1;
    if (isAbnormal && issues.includes('no_page')) noPage += 1;
    if (isAbnormal && issues.includes('absurd_yoy')) absurdYoy += 1;

    rows.push({
      code: bucket.code,
      name: bucket.name,
      title: bucket.title,
      period: bucket.period,
      announcementId: bucket.announcementId,
      href: `/${bucket.code}?period=${encodeURIComponent(bucket.period)}`,
      metrics,
      issues,
      abnormal: isAbnormal,
      acked,
      flagged,
      reviewNote,
    });
  }

  rows.sort((a, b) => {
    const pr = overviewPeriodRank(b.period) - overviewPeriodRank(a.period);
    if (pr !== 0) return pr;
    return a.code.localeCompare(b.code);
  });

  return {
    rows,
    summary: {
      rows: rows.length,
      abnormal,
      missingCore,
      noPage,
      absurdYoy,
    },
  };
}

export function issueLabel(issue: OverviewIssue): string {
  if (issue === 'missing') return '缺核';
  if (issue === 'no_page') return '无页码';
  return '同比离谱';
}
