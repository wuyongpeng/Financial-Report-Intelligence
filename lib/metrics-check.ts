/**
 * Third-party vs DB financial_metrics reconciliation helpers.
 * Pure functions — used by /api/admin/check and unit tests.
 */

export type CheckMetric = 'revenue' | 'net_profit' | 'eps' | 'roe';

export type ThirdPartyRow = {
  code: string;
  revenueYi: number;
  netProfitYi: number;
  eps: number;
  roe: number;
};

export type DbMetricRow = {
  code: string;
  name?: string | null;
  period: string;
  metric: CheckMetric;
  value: number;
  unit: string | null;
};

export type CheckStatus = 'OK' | 'BAD' | 'MISS';

export type CheckCell = {
  code: string;
  name: string;
  period: string | null;
  metric: CheckMetric;
  metricLabel: string;
  thirdParty: number | null;
  /** Best converted comparable number (亿元 for currency; raw for eps/roe). */
  dbConverted: number | null;
  /** Raw DB value + unit for display. */
  dbRaw: string | null;
  status: CheckStatus;
  /** Relative/abs gap when both sides present. */
  relDiff: number | null;
};

export type CheckSummary = Record<CheckMetric, { ok: number; bad: number; miss: number }>;

export const CHECK_METRICS: CheckMetric[] = ['revenue', 'net_profit', 'eps', 'roe'];

export const METRIC_LABEL: Record<CheckMetric, string> = {
  revenue: '营业总收入',
  net_profit: '归母净利润',
  eps: '基本每股收益',
  roe: '加权平均ROE',
};

const MONEY_SCALE: Record<string, number> = {
  元: 1,
  千元: 1e3,
  万元: 1e4,
  百万元: 1e6,
  亿元: 1e8,
};

/** Same ranking as crawl-display.periodTokenKey (H1 ≡ Q2). */
export function checkPeriodRank(token: string): number {
  const year = Number(token.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(token) ? 4 : /H1|Q2/.test(token) ? 2 : /Q3/.test(token) ? 3 : /Q1/.test(token) ? 1 : 0;
  return year * 10 + quarter;
}

export function thirdPartyValue(row: ThirdPartyRow, metric: CheckMetric): number {
  if (metric === 'revenue') return row.revenueYi;
  if (metric === 'net_profit') return row.netProfitYi;
  if (metric === 'eps') return row.eps;
  return row.roe;
}

/** Convert stored amount to 亿元 candidates, tolerating mislabeled 元/千元/万元. */
export function currencyYiCandidates(value: number, unit: string | null | undefined): number[] {
  if (!Number.isFinite(value)) return [];
  const labeled = (unit ?? '').replace(/\s+/g, '');
  const set = new Set<number>();
  const labeledScale = MONEY_SCALE[labeled];
  if (labeledScale != null) set.add((value * labeledScale) / 1e8);
  for (const scale of Object.values(MONEY_SCALE)) {
    set.add((value * scale) / 1e8);
  }
  return [...set];
}

/**
 * ~1% relative + small absolute tolerance (unit mislabels still match exactly).
 * abs floor: currency 0.05 亿; eps 0.02 元; roe 0.15 pct-pt.
 */
export function withinTolerance(a: number, b: number, metric: CheckMetric): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const absFloor = metric === 'revenue' || metric === 'net_profit' ? 0.05
    : metric === 'eps' ? 0.02
    : 0.15;
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return diff <= Math.max(absFloor, 0.01 * scale);
}

export function pickBestConverted(
  thirdParty: number,
  value: number,
  unit: string | null | undefined,
  metric: CheckMetric,
): { converted: number; ok: boolean; relDiff: number } {
  if (metric === 'eps' || metric === 'roe') {
    const converted = value;
    const relDiff = Math.abs(converted - thirdParty) / Math.max(Math.abs(thirdParty), Math.abs(converted), 1e-9);
    return { converted, ok: withinTolerance(converted, thirdParty, metric), relDiff };
  }
  const candidates = currencyYiCandidates(value, unit);
  let best = candidates[0] ?? value / 1e8;
  let bestDiff = Math.abs(best - thirdParty);
  for (const c of candidates) {
    const d = Math.abs(c - thirdParty);
    if (d < bestDiff) {
      best = c;
      bestDiff = d;
    }
  }
  const relDiff = bestDiff / Math.max(Math.abs(thirdParty), Math.abs(best), 1e-9);
  return { converted: best, ok: withinTolerance(best, thirdParty, metric), relDiff };
}

export function formatRaw(value: number, unit: string | null | undefined): string {
  const u = (unit ?? '').trim() || '—';
  const n = Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
    : String(value);
  return `${n} ${u}`;
}

export function formatConverted(metric: CheckMetric, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (metric === 'revenue' || metric === 'net_profit') {
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿元`;
  }
  if (metric === 'roe') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
}

/** Latest period per code among provided DB rows. */
export function latestPeriodByCode(rows: DbMetricRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const prev = map.get(row.code);
    if (!prev || checkPeriodRank(row.period) > checkPeriodRank(prev)) {
      map.set(row.code, row.period);
    }
  }
  return map;
}

export function buildCheckCells(
  thirdParty: ThirdPartyRow[],
  dbRows: DbMetricRow[],
): { cells: CheckCell[]; summary: CheckSummary; periodNote: string } {
  const byCodeMetric = new Map<string, DbMetricRow>();
  const latest = latestPeriodByCode(dbRows);
  const nameByCode = new Map<string, string>();
  for (const row of dbRows) {
    if (row.name) nameByCode.set(row.code, row.name);
    if (latest.get(row.code) !== row.period) continue;
    byCodeMetric.set(`${row.code}:${row.metric}`, row);
  }

  const periodCounts = new Map<string, number>();
  for (const p of latest.values()) periodCounts.set(p, (periodCounts.get(p) ?? 0) + 1);
  const topPeriod = [...periodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  const periodNote = `库内对照期次多为 ${topPeriod}（每家取最新一期）`;

  const summary: CheckSummary = {
    revenue: { ok: 0, bad: 0, miss: 0 },
    net_profit: { ok: 0, bad: 0, miss: 0 },
    eps: { ok: 0, bad: 0, miss: 0 },
    roe: { ok: 0, bad: 0, miss: 0 },
  };

  const cells: CheckCell[] = [];
  for (const tp of thirdParty) {
    const period = latest.get(tp.code) ?? null;
    const name = nameByCode.get(tp.code) ?? '';
    for (const metric of CHECK_METRICS) {
      const db = byCodeMetric.get(`${tp.code}:${metric}`);
      const third = thirdPartyValue(tp, metric);
      if (!db || !Number.isFinite(db.value)) {
        summary[metric].miss += 1;
        cells.push({
          code: tp.code,
          name,
          period,
          metric,
          metricLabel: METRIC_LABEL[metric],
          thirdParty: third,
          dbConverted: null,
          dbRaw: null,
          status: 'MISS',
          relDiff: null,
        });
        continue;
      }
      const picked = pickBestConverted(third, db.value, db.unit, metric);
      const status: CheckStatus = picked.ok ? 'OK' : 'BAD';
      if (status === 'OK') summary[metric].ok += 1;
      else summary[metric].bad += 1;
      cells.push({
        code: tp.code,
        name,
        period,
        metric,
        metricLabel: METRIC_LABEL[metric],
        thirdParty: third,
        dbConverted: picked.converted,
        dbRaw: formatRaw(db.value, db.unit),
        status,
        relDiff: picked.relDiff,
      });
    }
  }

  return { cells, summary, periodNote };
}
