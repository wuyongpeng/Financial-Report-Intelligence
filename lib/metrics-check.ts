/**
 * Third-party vs DB financial_metrics reconciliation helpers.
 * Pure functions — used by /api/admin/check and unit tests.
 */

import { rowSearchHaystack } from './admin-table-search';

export type CheckMetric = 'revenue' | 'net_profit' | 'eps' | 'roe';

export type ThirdPartyRow = {
  code: string;
  name?: string;
  period: string;
  revenueYi: number | null;
  netProfitYi: number | null;
  eps: number | null;
  roe: number | null;
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
  /** e.g. Q3 single-quarter folded with H1 into YTD. */
  note: string | null;
};

export type CheckSummary = Record<CheckMetric, { ok: number; bad: number; miss: number }>;

export const CHECK_METRICS: CheckMetric[] = ['revenue', 'net_profit', 'eps', 'roe'];

export const METRIC_LABEL: Record<CheckMetric, string> = {
  revenue: '营业总收入',
  net_profit: '归母净利润',
  eps: '基本每股收益',
  roe: '加权平均ROE',
};

/** Metrics where Q3 single-quarter + H1 ≈ YTD cumulative (third-party Q3 style). */
export const ADDITIVE_CHECK_METRICS: ReadonlySet<CheckMetric> = new Set(['revenue', 'net_profit', 'eps']);

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

/** Map 2026Q3 → 2026H1 (mid-year companion for YTD fold). */
export function h1PeriodForQ3(period: string): string | null {
  const m = period.match(/^(20\d{2})Q3$/i);
  return m ? `${m[1]}H1` : null;
}

export function thirdPartyValue(row: ThirdPartyRow, metric: CheckMetric): number | null {
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

/** Best Q3+H1 sum in comparable units vs third-party (currency → 亿元). */
export function pickBestFoldedSum(
  thirdParty: number,
  q3Value: number,
  q3Unit: string | null | undefined,
  h1Value: number,
  h1Unit: string | null | undefined,
  metric: CheckMetric,
): { converted: number; ok: boolean; relDiff: number } {
  if (metric === 'eps') {
    const converted = q3Value + h1Value;
    const relDiff = Math.abs(converted - thirdParty) / Math.max(Math.abs(thirdParty), Math.abs(converted), 1e-9);
    return { converted, ok: withinTolerance(converted, thirdParty, metric), relDiff };
  }
  // revenue / net_profit
  const q3Cands = currencyYiCandidates(q3Value, q3Unit);
  const h1Cands = currencyYiCandidates(h1Value, h1Unit);
  let best = (q3Cands[0] ?? q3Value / 1e8) + (h1Cands[0] ?? h1Value / 1e8);
  let bestDiff = Math.abs(best - thirdParty);
  for (const q of q3Cands) {
    for (const h of h1Cands) {
      const sum = q + h;
      const d = Math.abs(sum - thirdParty);
      if (d < bestDiff) {
        best = sum;
        bestDiff = d;
      }
    }
  }
  const relDiff = bestDiff / Math.max(Math.abs(thirdParty), Math.abs(best), 1e-9);
  return { converted: best, ok: withinTolerance(best, thirdParty, metric), relDiff };
}

/**
 * Prefer Q3 alone when it already matches; otherwise fold H1+Q3 for additive metrics
 * when the sum is clearly better (typical: DB Q3 is single-quarter, TP is YTD).
 */
export function pickQ3Comparable(
  thirdParty: number,
  q3: DbMetricRow,
  h1: DbMetricRow | null | undefined,
  metric: CheckMetric,
): { converted: number; ok: boolean; relDiff: number; folded: boolean } {
  const alone = pickBestConverted(thirdParty, q3.value, q3.unit, metric);
  if (alone.ok || !ADDITIVE_CHECK_METRICS.has(metric) || !h1 || !Number.isFinite(h1.value)) {
    return { ...alone, folded: false };
  }
  const folded = pickBestFoldedSum(thirdParty, q3.value, q3.unit, h1.value, h1.unit, metric);
  const aloneDiff = Math.abs(alone.converted - thirdParty);
  const foldedDiff = Math.abs(folded.converted - thirdParty);
  // Use fold when it matches, or when clearly closer and alone looks like a single quarter vs YTD.
  const aloneLooksSingle = aloneDiff > Math.max(Math.abs(thirdParty) * 0.15, 0.5);
  if (folded.ok || (foldedDiff < aloneDiff && aloneLooksSingle)) {
    return { ...folded, folded: true };
  }
  return { ...alone, folded: false };
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

function lookupDb(
  byCodePeriodMetric: Map<string, DbMetricRow>,
  code: string,
  period: string,
  metric: CheckMetric,
): DbMetricRow | undefined {
  const direct = byCodePeriodMetric.get(`${code}:${period}:${metric}`);
  if (direct) return direct;
  // H1 ≡ Q2 mid-year filing
  if (/H1$/i.test(period)) {
    return byCodePeriodMetric.get(`${code}:${period.replace(/H1$/i, 'Q2')}:${metric}`);
  }
  if (/Q2$/i.test(period)) {
    return byCodePeriodMetric.get(`${code}:${period.replace(/Q2$/i, 'H1')}:${metric}`);
  }
  return undefined;
}

/** True when DB still has at least one check metric for this code×period (H1≡Q2). */
export function hasDbCheckMetricsForPeriod(
  byCodePeriodMetric: Map<string, DbMetricRow>,
  code: string,
  period: string,
): boolean {
  return CHECK_METRICS.some((metric) => Boolean(lookupDb(byCodePeriodMetric, code, period, metric)));
}

export function buildCheckCells(
  thirdParty: ThirdPartyRow[],
  dbRows: DbMetricRow[],
): { cells: CheckCell[]; summary: CheckSummary; periodNote: string } {
  // Match ONLY same code + period (do not pick latest DB period).
  const byCodePeriodMetric = new Map<string, DbMetricRow>();
  const nameByCode = new Map<string, string>();
  for (const row of dbRows) {
    if (row.name) nameByCode.set(row.code, row.name);
    byCodePeriodMetric.set(`${row.code}:${row.period}:${row.metric}`, row);
  }

  const periodCounts = new Map<string, number>();
  for (const tp of thirdParty) {
    periodCounts.set(tp.period, (periodCounts.get(tp.period) ?? 0) + 1);
  }
  const periodList = [...periodCounts.entries()]
    .sort((a, b) => checkPeriodRank(a[0]) - checkPeriodRank(b[0]))
    .map(([p, n]) => `${p}×${n}`)
    .join('、');
  const periodNote = periodList
    ? `仅对照问财第三方已有期次（${periodList}），同公司同期比对；库内该期次已无核对指标（如运营已删）则不展示；Q3 若库内为单季则对营收/净利/EPS 加同公司 H1 折成累计再比（ROE 不折算）`
    : '仅对照问财第三方已有期次；库内该期次已无核对指标则不展示；Q3 若库内为单季则对营收/净利/EPS 加同公司 H1 折成累计再比（ROE 不折算）';

  const summary: CheckSummary = {
    revenue: { ok: 0, bad: 0, miss: 0 },
    net_profit: { ok: 0, bad: 0, miss: 0 },
    eps: { ok: 0, bad: 0, miss: 0 },
    roe: { ok: 0, bad: 0, miss: 0 },
  };

  const cells: CheckCell[] = [];
  for (const tp of thirdParty) {
    const period = tp.period;
    // Skip code×period when stock metrics were cleared (metrics delete). Do not use H1-only
    // presence to keep a deleted Q3 row, and do not drop a Q3 that still has its own rows.
    if (!hasDbCheckMetricsForPeriod(byCodePeriodMetric, tp.code, period)) {
      continue;
    }
    const name = tp.name || nameByCode.get(tp.code) || '';
    const h1Period = h1PeriodForQ3(period);
    for (const metric of CHECK_METRICS) {
      const third = thirdPartyValue(tp, metric);
      const db = lookupDb(byCodePeriodMetric, tp.code, period, metric);
      // Null/missing third-party metric → MISS for that metric only
      if (third == null || !Number.isFinite(third)) {
        summary[metric].miss += 1;
        cells.push({
          code: tp.code,
          name,
          period,
          metric,
          metricLabel: METRIC_LABEL[metric],
          thirdParty: null,
          dbConverted: null,
          dbRaw: db ? formatRaw(db.value, db.unit) : null,
          status: 'MISS',
          relDiff: null,
          note: null,
        });
        continue;
      }
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
          note: null,
        });
        continue;
      }

      let picked: { converted: number; ok: boolean; relDiff: number; folded: boolean };
      if (h1Period) {
        const h1 = lookupDb(byCodePeriodMetric, tp.code, h1Period, metric);
        picked = pickQ3Comparable(third, db, h1, metric);
      } else {
        const alone = pickBestConverted(third, db.value, db.unit, metric);
        picked = { ...alone, folded: false };
      }

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
        note: picked.folded ? 'Q3单季已加H1折累计' : null,
      });
    }
  }

  return { cells, summary, periodNote };
}

/** Visible admin/check table text for quick search (status OK/BAD/MISS etc.). */
export function checkCellSearchParts(cell: CheckCell): Array<string | number | null | undefined> {
  return [
    cell.code,
    cell.name,
    cell.period,
    cell.metric,
    cell.metricLabel,
    cell.thirdParty,
    cell.dbConverted,
    cell.dbRaw,
    cell.status,
    cell.note,
    cell.relDiff,
    formatConverted(cell.metric, cell.thirdParty),
    formatConverted(cell.metric, cell.dbConverted),
  ];
}

export function checkCellMatchesSearch(cell: CheckCell, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return rowSearchHaystack(checkCellSearchParts(cell)).includes(q);
}
