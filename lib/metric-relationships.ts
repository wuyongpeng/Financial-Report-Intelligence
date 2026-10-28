/**
 * 数字关系（v1）：少而硬的跨指标勾稽，只提示「现象 + 双出处」，不下投资结论。
 * 素材可复用 focus-highlights 阈值；产品 UI 独立，不恢复「重点关注」。
 */
import { formatYoyBadge, resolveYoy, describeYoy, yoyTone, type YoyResult } from './crawl-display';
import { FOCUS_MAX_CARDS, FOCUS_THRESHOLDS } from './focus-highlights-config';
import { labels, value, type MetricName, type Report } from './detail-model';

export type MetricRelCite = {
  page: number;
  quote: string;
  metric?: MetricName;
};

export type MetricRelNumber = {
  metric: MetricName;
  label: string;
  /** 主数字文案，如「12.34 亿元」或带同比 */
  valueText: string;
  page?: number;
};

export type MetricRelationshipCard = {
  id: 'revenue_vs_profit_yoy' | 'cash_vs_profit';
  /** 卡内小标题（名词块风格，非组名） */
  title: string;
  /** 一句现象陈述，禁止投资建议 */
  phenomenon: string;
  numbers: MetricRelNumber[];
  cites: MetricRelCite[];
  /** 预填右栏追问，用户点「追问这条」才写入输入框 */
  askPrompt: string;
};

const YI = 1e8;

const ADVICE_BANNED =
  /投资建议|建议(?:减持|增持|买入|卖出|加仓|减仓)|目标价|买入|卖出|减持|增持|加仓|减仓|推荐(?:买入|卖出)/;

function yi(n: number): string {
  return (n / YI).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ratioText(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function citeFor(report: Report, metric: MetricName): MetricRelCite | null {
  const item = report.metrics.find((m) => m.metric === metric);
  if (!item?.source_page) return null;
  return {
    page: item.source_page,
    quote: item.source_label ?? labels[metric],
    metric,
  };
}

function citesOf(report: Report, metrics: MetricName[]): MetricRelCite[] {
  const out: MetricRelCite[] = [];
  const seen = new Set<number>();
  for (const m of metrics) {
    const c = citeFor(report, m);
    if (!c || seen.has(c.page)) continue;
    seen.add(c.page);
    out.push(c);
  }
  return out;
}

function pageHint(cites: MetricRelCite[]): string {
  if (!cites.length) return '';
  const pages = cites.map((c) => `第 ${c.page} 页`).join('、');
  return `（出处：PDF ${pages}）`;
}

function resolveMetricYoy(
  report: Report,
  previous: Report | null | undefined,
  metric: MetricName,
  preferDisclosed: boolean,
): YoyResult | undefined {
  const current = value(report, metric);
  const row = report.metrics.find((m) => m.metric === metric);
  const crossPrior = previous ? value(previous, metric) : undefined;
  if (preferDisclosed) {
    return resolveYoy(current, {
      disclosedPrior: row?.prior_value,
      disclosedYoyPct: row?.yoy_pct,
      crossReportPrior: crossPrior,
    });
  }
  return describeYoy(current, crossPrior);
}

/** Direction used for sign-divergence: up / down only (neutral → no signal). */
function yoyDirection(yoy: YoyResult | undefined): 'up' | 'down' | null {
  if (!yoy) return null;
  const tone = yoyTone(yoy);
  if (tone === 'up' || tone === 'down') return tone;
  return null;
}

function assertNoAdvice(text: string): string {
  if (ADVICE_BANNED.test(text)) {
    throw new Error(`metric-relationships: conclusion contains banned advice wording: ${text}`);
  }
  return text;
}

function evalRevenueVsProfitYoy(
  report: Report,
  previous: Report | null | undefined,
  preferDisclosed: boolean,
): MetricRelationshipCard | null {
  const revYoy = resolveMetricYoy(report, previous, 'revenue', preferDisclosed);
  const profitYoy = resolveMetricYoy(report, previous, 'net_profit', preferDisclosed);
  const revDir = yoyDirection(revYoy);
  const profitDir = yoyDirection(profitYoy);
  if (!revDir || !profitDir) return null;
  if (revDir === profitDir) return null;

  const revenue = value(report, 'revenue');
  const profit = value(report, 'net_profit');
  if (revenue === undefined || profit === undefined) return null;

  const revBadge = formatYoyBadge(revYoy, 1);
  const profitBadge = formatYoyBadge(profitYoy, 1);
  const cites = citesOf(report, ['revenue', 'net_profit']);

  const phenomenon = assertNoAdvice(
    `营业收入同比为${revDir === 'up' ? '正' : '负'}（${revBadge}），归母净利润同比为${profitDir === 'up' ? '正' : '负'}（${profitBadge}），方向背离。`,
  );

  const numbers: MetricRelNumber[] = [
    {
      metric: 'revenue',
      label: labels.revenue,
      valueText: `${yi(revenue)} 亿元 · ${revBadge}`,
      page: citeFor(report, 'revenue')?.page,
    },
    {
      metric: 'net_profit',
      label: labels.net_profit,
      valueText: `${yi(profit)} 亿元 · ${profitBadge}`,
      page: citeFor(report, 'net_profit')?.page,
    },
  ];

  const askPrompt =
    `本期营业收入同比 ${revBadge}，归母净利润同比 ${profitBadge}，方向背离。` +
    `请结合原文解释为什么可能出现这种关系，给出可能原因，并引用出处页码。` +
    `${pageHint(cites)}` +
    `不要给出买卖或持仓建议。`;

  return {
    id: 'revenue_vs_profit_yoy',
    title: '营收与净利同比',
    phenomenon,
    numbers,
    cites,
    askPrompt,
  };
}

function evalCashVsProfit(report: Report): MetricRelationshipCard | null {
  const profit = value(report, 'net_profit');
  const ocf = value(report, 'operating_cash_flow');
  if (profit === undefined || ocf === undefined) return null;

  const thr = FOCUS_THRESHOLDS.cashToProfitRatio;
  const ratio = profit !== 0 ? ocf / profit : undefined;
  const signal =
    (profit > 0 && ocf < 0) ||
    (ratio !== undefined && Number.isFinite(ratio) && ratio < thr);
  if (!signal) return null;

  const cites = citesOf(report, ['net_profit', 'operating_cash_flow']);
  const ratioPart =
    ratio !== undefined && Number.isFinite(ratio) ? ratioText(ratio) : '—';

  const phenomenon = assertNoAdvice(
    profit > 0 && ocf < 0
      ? `归母净利润 ${yi(profit)} 亿元为正，经营现金流净额 ${yi(ocf)} 亿元为负。`
      : `归母净利润 ${yi(profit)} 亿元，经营现金流净额 ${yi(ocf)} 亿元，净现比 ${ratioPart}。`,
  );

  const numbers: MetricRelNumber[] = [
    {
      metric: 'net_profit',
      label: labels.net_profit,
      valueText: `${yi(profit)} 亿元`,
      page: citeFor(report, 'net_profit')?.page,
    },
    {
      metric: 'operating_cash_flow',
      label: labels.operating_cash_flow,
      valueText:
        ratio !== undefined && Number.isFinite(ratio)
          ? `${yi(ocf)} 亿元 · 净现比 ${ratioPart}`
          : `${yi(ocf)} 亿元`,
      page: citeFor(report, 'operating_cash_flow')?.page,
    },
  ];

  const askPrompt =
    `本期归母净利润 ${yi(profit)} 亿元，经营现金流净额 ${yi(ocf)} 亿元` +
    (ratio !== undefined && Number.isFinite(ratio) ? `（净现比 ${ratioPart}）` : '') +
    `。请结合原文解释利润与经营现金流为何可能出现这种关系，并引用出处页码。` +
    `${pageHint(cites)}` +
    `不要给出买卖或持仓建议。`;

  return {
    id: 'cash_vs_profit',
    title: '利润与经营现金流',
    phenomenon,
    numbers,
    cites,
    askPrompt,
  };
}

export type BuildMetricRelationshipsOpts = {
  previous?: Report | null;
  /** 与概览同比一致：默认基准时优先披露同比 */
  preferDisclosedYoy?: boolean;
  /** 同时最多几张；默认 FOCUS_MAX_CARDS */
  maxCards?: number;
};

/**
 * 仅返回命中的关系卡；全空返回 []（UI 整块隐藏）。
 * v1：(a) 营收↔归母净利同比符号背离；(b) 净利↔经营现金流（复用净现比阈值）。
 * (c) 暂不上。
 */
export function buildMetricRelationships(
  report: Report,
  opts: BuildMetricRelationshipsOpts = {},
): MetricRelationshipCard[] {
  const previous = opts.previous ?? null;
  const preferDisclosed = opts.preferDisclosedYoy !== false;
  const max = opts.maxCards ?? FOCUS_MAX_CARDS;

  const candidates: MetricRelationshipCard[] = [];
  const a = evalRevenueVsProfitYoy(report, previous, preferDisclosed);
  if (a) candidates.push(a);
  const b = evalCashVsProfit(report);
  if (b) candidates.push(b);

  return candidates.slice(0, max);
}

/** 测试用：结论是否含投资建议禁用词 */
export function containsInvestmentAdvice(text: string): boolean {
  return ADVICE_BANNED.test(text);
}
