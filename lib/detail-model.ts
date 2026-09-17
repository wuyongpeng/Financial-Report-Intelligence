import { canonicalPeriodFromTitle, reportKindFromPeriod } from './ingest-period';
import { betterKeepCandidate } from './period-dedupe';

export const metricNames = ['revenue', 'net_profit', 'eps', 'roe'] as const;
// Balance-sheet and cash-flow rows power the health module; they are not headline cards.
export const supportMetricNames = ['total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost'] as const;
export const allMetricNames = [...metricNames, ...supportMetricNames] as const;
export type HeadlineMetric = typeof metricNames[number];
export type MetricName = typeof allMetricNames[number];
export type Metric = { metric: MetricName; value: number; unit: string; source_page: number | null; source_label: string | null; confidence: number; verified: number; period: string };
export type Report = { id: string; code: string; company_name: string; title: string; report_type: string; published_at: string; parsed_at: string | null; industry: string; status: string; metrics: Metric[] };
export type Citation = { id?: string; reportId?: string; companyName?: string; period?: string; page: number; quote: string; code?: string };
export const labels: Record<MetricName, string> = {
  revenue: '营业收入', net_profit: '归母净利润', eps: '每股收益 EPS', roe: '净资产收益率 ROE',
  total_assets: '资产总计', total_liabilities: '负债合计', operating_cash_flow: '经营现金流净额', operating_cost: '营业成本',
};
const currencyMetrics = new Set<MetricName>(['revenue', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost']);
export function value(report: Report | undefined, metric: MetricName) { return report?.metrics.find(item => item.metric === metric)?.value; }
export function period(report: Report) {
  return canonicalPeriodFromTitle(report.title, report.published_at) ?? report.metrics[0]?.period ?? report.title;
}
export function filingType(report: Report) {
  return reportKindFromPeriod(period(report)) ?? (report.report_type === 'annual' || report.report_type === 'semiannual' || report.report_type === 'quarterly' ? report.report_type : 'other');
}
export function format(n: number | undefined, metric: MetricName) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return currencyMetrics.has(metric) ? `${(n / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿` : `${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${metric === 'roe' ? '%' : ' 元'}`;
}
// Bare number for contexts that already declare the unit at block level.
export function amount(n: number | undefined, metric: MetricName) {
  if (n === undefined || !Number.isFinite(n)) return '—';
  return currencyMetrics.has(metric) ? (n / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
export function unitOf(metric: MetricName) { return currencyMetrics.has(metric) ? '亿元' : metric === 'roe' ? '%' : '元'; }

// Ratios stay undefined unless every input is present; never impute a denominator.
export function debtRatio(report: Report | undefined) {
  const assets = value(report, 'total_assets'), liabilities = value(report, 'total_liabilities');
  return assets !== undefined && liabilities !== undefined && assets > 0 ? liabilities / assets * 100 : undefined;
}
export function cashConversion(report: Report | undefined) {
  const cash = value(report, 'operating_cash_flow'), profit = value(report, 'net_profit');
  return cash !== undefined && profit !== undefined && profit > 0 ? cash / profit * 100 : undefined;
}
export function grossMargin(report: Report | undefined) {
  const revenue = value(report, 'revenue'), cost = value(report, 'operating_cost');
  return revenue !== undefined && cost !== undefined && revenue > 0 ? (revenue - cost) / revenue * 100 : undefined;
}
export function change(current: number | undefined, prior: number | undefined) { return current === undefined || prior === undefined || prior === 0 ? undefined : (current - prior) / Math.abs(prior) * 100; }
export function periodKey(report: Report) {
  const p = period(report); const year = Number(p.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(p) ? 4 : /H1|Q2/.test(p) ? 2 : /Q3/.test(p) ? 3 : /Q1/.test(p) ? 1 : 0;
  return year * 10 + quarter;
}
export function comparableHistory(reports: Report[], selected: Report) {
  const suffix = period(selected).replace(/20\d{2}/, '');
  const unique = new Map<string, Report>();
  for (const r of reports) {
    if (filingType(r) !== filingType(selected) || periodKey(r) > periodKey(selected) || period(r).replace(/20\d{2}/, '') !== suffix || !r.metrics.length) continue;
    const token = period(r);
    unique.set(token, betterKeepCandidate(unique.get(token), r));
  }
  return [...unique.values()].sort((a,b) => periodKey(a)-periodKey(b));
}
/** Time-ordered Q1 / H1 / Q3 / FY series so the trend chart shows path, not only YoY pairs. */
export function sequentialHistory(reports: Report[], selected: Report, limit = 8) {
  const cap = periodKey(selected);
  const unique = new Map<string, Report>();
  for (const r of reports) {
    if (periodKey(r) > cap || !r.metrics.length) continue;
    const token = period(r);
    unique.set(token, betterKeepCandidate(unique.get(token), r));
  }
  return [...unique.values()].sort((a, b) => periodKey(a) - periodKey(b) || a.published_at.localeCompare(b.published_at)).slice(-limit);
}
export function priorYear(reports: Report[], selected: Report) {
  const p = period(selected); const year = p.match(/20\d{2}/)?.[0];
  if (!year) return undefined;
  const prior = p.replace(year, String(Number(year) - 1));
  let best: Report | undefined;
  for (const r of reports) {
    if (filingType(r) !== filingType(selected) || period(r) !== prior || !r.metrics.length) continue;
    best = betterKeepCandidate(best, r);
  }
  return best;
}
export function pickCanonicalReports(reports: Report[]) {
  const unique = new Map<string, Report>();
  for (const r of reports) unique.set(period(r), betterKeepCandidate(unique.get(period(r)), r));
  return [...unique.values()].sort((a, b) => periodKey(b) - periodKey(a) || b.published_at.localeCompare(a.published_at));
}
export function moduleForQuestion(q: string) {
  if (/为什么|原因|归因|利润.*下降|利润.*变化/.test(q)) return 'attribution';
  if (/同行|同业|水位|对比|竞品/.test(q)) return 'peers';
  if (/业务|产品|地区|构成/.test(q)) return 'business';
  if (/异常|异动|风险/.test(q)) return 'anomalies';
  if (/历史|趋势|过去|历年/.test(q)) return 'history';
  return null;
}
// Exact two-factor bridge; all inputs must share the same consolidated scope.
export function profitBridge(revenue: number, profit: number, previousRevenue: number, previousProfit: number) {
  if (revenue <= 0 || previousRevenue <= 0) return null;
  const revenueEffect = (revenue - previousRevenue) * previousProfit / previousRevenue;
  return { revenueEffect, marginEffect: profit - previousProfit - revenueEffect, previousProfit, profit };
}

export function sourceRange(text: string, quote: string): [number, number] | null {
  if (!quote.trim()) return null;
  const positions: number[] = [];
  let normalized = '';
  for (let i = 0; i < text.length; i++) if (!/\s/.test(text[i])) { normalized += text[i]; positions.push(i); }
  const needle = quote.replace(/\s/g, '');
  const at = normalized.indexOf(needle);
  return at < 0 ? null : [positions[at], positions[at + needle.length - 1] + 1];
}

export type Finding = { id: string; metric: MetricName; headline: string; detail: string; module: string; severity: 'watch' | 'info' };
// Findings are ranked restatements of parsed numbers, never new claims. Anything
// that needs a missing input is simply not produced.
export function keyFindings(reports: Report[], selected: Report): Finding[] {
  const prior = priorYear(reports, selected);
  const history = comparableHistory(reports, selected);
  const out: Finding[] = [];
  for (const metric of metricNames) {
    const delta = change(value(selected, metric), value(prior, metric));
    if (delta === undefined) continue;
    const series = history.map(r => value(r, metric)).filter((v): v is number => v !== undefined);
    const current = value(selected, metric)!;
    const extreme = series.length >= 3 && (current === Math.max(...series) || current === Math.min(...series))
      ? `，为近 ${series.length} 期${current === Math.max(...series) ? '最高' : '最低'}` : '';
    out.push({
      id: `finding-${metric}`,
      metric,
      headline: `${labels[metric]}同比 ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`,
      detail: `本期 ${format(current, metric)}，上年同期 ${format(value(prior, metric), metric)}${extreme}`,
      module: 'anomalies',
      severity: Math.abs(delta) >= 30 ? 'watch' : 'info',
    });
  }
  const cash = cashConversion(selected);
  if (cash !== undefined && cash < 80) out.push({
    id: 'finding-cash', metric: 'operating_cash_flow',
    headline: `经营现金流仅覆盖归母净利润的 ${cash.toFixed(0)}%`,
    detail: `经营现金流净额 ${format(value(selected, 'operating_cash_flow'), 'operating_cash_flow')}，低于同期归母净利润`,
    module: 'attribution', severity: 'watch',
  });
  const leverage = debtRatio(selected);
  if (leverage !== undefined && leverage >= 70) out.push({
    id: 'finding-leverage', metric: 'total_liabilities',
    headline: `资产负债率 ${leverage.toFixed(1)}%`,
    detail: `负债合计 ${format(value(selected, 'total_liabilities'), 'total_liabilities')} ÷ 资产总计 ${format(value(selected, 'total_assets'), 'total_assets')}`,
    module: 'attribution', severity: 'watch',
  });
  return out
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'watch' ? -1 : 1))
    .slice(0, 3);
}

function clipChars(text: string, max = 50) {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function signedPct(delta: number) {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

/** One-line, number-backed module headlines. Empty string means show nothing. */
export function attributionConclusion(bridge: NonNullable<ReturnType<typeof profitBridge>>) {
  const delta = bridge.profit - bridge.previousProfit;
  const verb = delta > 0 ? '增加' : delta < 0 ? '减少' : '持平';
  const amountText = delta === 0 ? '' : ` ${format(Math.abs(delta), 'net_profit')}`;
  return `归母净利同比${verb}${amountText}，其中收入贡献 ${format(bridge.revenueEffect, 'net_profit')}、净利率贡献 ${format(bridge.marginEffect, 'net_profit')}`;
}

export function anomaliesConclusion(flagged: Array<{ metric: MetricName; amount: number }>, comparableCount = 0) {
  if (flagged.length) {
    return flagged.map((d) => `${labels[d.metric]}同比 ${d.amount >= 0 ? '+' : ''}${d.amount.toFixed(2)}%`).join('；');
  }
  return comparableCount > 0 ? '核心指标同比波动均未超过 30%' : '';
}

export function historyConclusion(history: Report[]) {
  if (history.length < 2) return '';
  const first = history[0], last = history[history.length - 1];
  const bits: string[] = [];
  const a = value(first, 'revenue'), b = value(last, 'revenue');
  if (a !== undefined && b !== undefined) {
    const delta = change(b, a);
    bits.push(`营收由 ${format(a, 'revenue')} 至 ${format(b, 'revenue')}${delta === undefined ? '' : `（${signedPct(delta)}）`}`);
  }
  const pa = value(first, 'net_profit'), pb = value(last, 'net_profit');
  if (pa !== undefined && pb !== undefined) {
    const delta = change(pb, pa);
    bits.push(`归母净利由 ${format(pa, 'net_profit')} 至 ${format(pb, 'net_profit')}${delta === undefined ? '' : `（${signedPct(delta)}）`}`);
  }
  return bits.length ? `近${history.length}期${bits.join('，')}` : '';
}

export function peersConclusion(rows: Array<{ rank: number; total: number; label: string }>) {
  const usable = rows.filter((row) => row.total >= 2);
  if (!usable.length) return '';
  return `${usable.map((row) => `${row.label}第 ${row.rank}/${row.total} 家`).join('，')}，非全行业排名`;
}

/** One-line overview conclusion; keep it short enough to scan. */
export function periodConclusion(reports: Report[], selected: Report, maxChars = 50) {
  const findings = keyFindings(reports, selected);
  const top = findings[0];
  const revenue = value(selected, 'revenue');
  const profit = value(selected, 'net_profit');
  let text = '';
  if (top) {
    text = top.severity === 'watch' ? `${top.headline}，需关注` : top.headline;
  } else if (revenue !== undefined || profit !== undefined) {
    const bits = [`${period(selected)}`];
    if (revenue !== undefined) bits.push(`营收 ${format(revenue, 'revenue')}`);
    if (profit !== undefined) bits.push(`净利 ${format(profit, 'net_profit')}`);
    text = bits.join('，');
  } else {
    text = `${period(selected)} 核心指标解析中`;
  }
  return clipChars(text, maxChars);
}
