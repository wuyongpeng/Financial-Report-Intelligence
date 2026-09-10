// The four headline metrics drive the cards, the trend chart and the peer table.
export const metricNames = ['revenue', 'net_profit', 'eps', 'roe'] as const;
// Balance-sheet and cash-flow rows power the health module; they are not headline cards.
export const supportMetricNames = ['total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost'] as const;
export const allMetricNames = [...metricNames, ...supportMetricNames] as const;
export type HeadlineMetric = typeof metricNames[number];
export type MetricName = typeof allMetricNames[number];
export type Metric = { metric: MetricName; value: number; unit: string; source_page: number | null; source_label: string | null; confidence: number; verified: number; period: string };
export type Report = { id: string; code: string; company_name: string; title: string; report_type: string; published_at: string; parsed_at: string | null; industry: string; status: string; metrics: Metric[] };
export type Citation = { id?: string; reportId?: string; companyName?: string; period?: string; page: number; quote: string };
export const labels: Record<MetricName, string> = {
  revenue: '营业收入', net_profit: '归母净利润', eps: '每股收益 EPS', roe: '净资产收益率 ROE',
  total_assets: '资产总计', total_liabilities: '负债合计', operating_cash_flow: '经营现金流净额', operating_cost: '营业成本',
};
const currencyMetrics = new Set<MetricName>(['revenue', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost']);
export function value(report: Report | undefined, metric: MetricName) { return report?.metrics.find(item => item.metric === metric)?.value; }
export function period(report: Report) { return report.metrics[0]?.period ?? report.title; }
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
  for (const r of [...reports].sort((a,b) => b.published_at.localeCompare(a.published_at))) {
    if (r.report_type !== selected.report_type || periodKey(r) > periodKey(selected) || period(r).replace(/20\d{2}/, '') !== suffix || !r.metrics.length) continue;
    if (!unique.has(period(r))) unique.set(period(r), r);
  }
  return [...unique.values()].sort((a,b) => periodKey(a)-periodKey(b));
}
export function priorYear(reports: Report[], selected: Report) {
  const p = period(selected); const year = p.match(/20\d{2}/)?.[0];
  if (!year) return undefined;
  const prior = p.replace(year, String(Number(year) - 1));
  return reports.find(r => r.report_type === selected.report_type && period(r) === prior);
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
      headline: `${labels[metric]}同比 ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
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
