/**
 * 重点关注：最多 2 张动态卡。
 * 约 10 个 watch-skill 维度巡检；有信号按严重度取 Top2；
 * 全空则落两个默认维，文案为「暂无风险」类冷静表述。
 */
import dimensionsSeed from '@/data/watch-skills/dimensions.json';
import { value, type MetricName, type Report } from './detail-model';
import { FOCUS_MAX_CARDS, FOCUS_THRESHOLDS } from './focus-highlights-config';

export type FocusHighlightStatus = 'signal' | 'none' | 'insufficient';

export type FocusCite = {
  page: number;
  quote: string;
  metric?: MetricName;
};

export type FocusHighlightCard = {
  id: string;
  title: string;
  status: FocusHighlightStatus;
  conclusion: string;
  cites: FocusCite[];
  /** Higher = more urgent; used for ranking before the 2-card cap. */
  severity?: number;
};

export type FocusPage = { page: number; content: string };

type WatchDimDef = {
  id: string;
  title: string;
  default?: boolean;
  severityBase?: number;
  digPit?: string;
  prompt?: string;
};

type WatchSkillSeed = {
  version: number;
  maxDisplay?: number;
  dimensions: WatchDimDef[];
};

const seed = dimensionsSeed as WatchSkillSeed;
const YI = 1e8;

function yi(n: number): string {
  return (n / YI).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct1(ratio: number): string {
  return (ratio * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function ratioText(n: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function citeFor(report: Report, metric: MetricName): FocusCite | null {
  const item = report.metrics.find((m) => m.metric === metric);
  if (!item?.source_page) return null;
  return {
    page: item.source_page,
    quote: item.source_label ?? metric,
    metric,
  };
}

function citesOf(report: Report, metrics: MetricName[]): FocusCite[] {
  const out: FocusCite[] = [];
  const seen = new Set<number>();
  for (const m of metrics) {
    const c = citeFor(report, m);
    if (!c || seen.has(c.page)) continue;
    seen.add(c.page);
    out.push(c);
  }
  return out;
}

function interestBearingParts(report: Report) {
  return {
    short: value(report, 'short_term_borrowings'),
    long: value(report, 'long_term_borrowings'),
    bonds: value(report, 'bonds_payable'),
    current: value(report, 'current_portion_debt'),
  };
}

/** Sum only disclosed parts; all-missing → undefined (do not treat as zero). */
function interestBearingDebt(report: Report): number | undefined {
  const parts = interestBearingParts(report);
  const vals = [parts.short, parts.long, parts.bonds, parts.current];
  if (vals.every((p) => p === undefined)) return undefined;
  return vals.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

function shortInterestBearing(report: Report): number | undefined {
  const { short, current } = interestBearingParts(report);
  if (short === undefined && current === undefined) return undefined;
  return (short ?? 0) + (current ?? 0);
}

function dimMeta(id: string): WatchDimDef | undefined {
  return seed.dimensions.find((d) => d.id === id);
}

function card(
  id: string,
  status: FocusHighlightStatus,
  conclusion: string,
  cites: FocusCite[],
  severity = 0,
): FocusHighlightCard {
  const meta = dimMeta(id);
  return {
    id,
    title: meta?.title ?? id,
    status,
    conclusion,
    cites,
    severity: status === 'signal' ? severity : 0,
  };
}

function evalNonRecurring(report: Report): FocusHighlightCard {
  const id = 'non_recurring';
  const cites = citesOf(report, ['non_recurring_pnl', 'profit_ex_non_recurring', 'net_profit']);
  const nr = value(report, 'non_recurring_pnl');
  const parent = value(report, 'net_profit');
  const ex = value(report, 'profit_ex_non_recurring');
  const base = dimMeta(id)?.severityBase ?? 80;

  if (parent === undefined || nr === undefined) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }

  const thr = FOCUS_THRESHOLDS.nonRecurringToParentProfit;
  const highShare = parent > 0 && nr / parent >= thr;
  const exNegative = parent > 0 && ex !== undefined && ex < 0;
  if (!highShare && !exNegative) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }

  let conclusion = `非经常性损益 ${yi(nr)} 亿元，占归母净利润 ${pct1(nr / parent)}%。`;
  if (exNegative && ex !== undefined) {
    conclusion += `扣非净利润为 ${yi(ex)} 亿元。`;
  }
  const sev = base + (exNegative ? 10 : 0) + Math.min(20, Math.floor((nr / Math.max(parent, 1)) * 40));
  return card(id, 'signal', conclusion, cites, sev);
}

function evalCashVsProfit(report: Report): FocusHighlightCard {
  const id = 'cash_vs_profit';
  const cites = citesOf(report, ['net_profit', 'operating_cash_flow']);
  const profit = value(report, 'net_profit');
  const ocf = value(report, 'operating_cash_flow');
  const base = dimMeta(id)?.severityBase ?? 85;

  if (profit === undefined || ocf === undefined) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }

  const thr = FOCUS_THRESHOLDS.cashToProfitRatio;
  const ratio = profit !== 0 ? ocf / profit : undefined;
  const signal =
    (profit > 0 && ocf < 0) ||
    (ratio !== undefined && Number.isFinite(ratio) && ratio < thr);

  if (!signal) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }

  const ratioPart =
    ratio !== undefined && Number.isFinite(ratio) ? ratioText(ratio) : '—';
  const sev = base + (profit > 0 && ocf < 0 ? 15 : 0);
  return card(
    id,
    'signal',
    `净利润 ${yi(profit)} 亿元，经营现金流净额 ${yi(ocf)} 亿元，净现比 ${ratioPart}。`,
    cites,
    sev,
  );
}

function evalCashAndDebt(report: Report): FocusHighlightCard {
  const id = 'cash_and_debt';
  const cites = citesOf(report, [
    'cash_and_equivalents',
    'restricted_cash',
    'total_assets',
    'short_term_borrowings',
    'long_term_borrowings',
    'bonds_payable',
    'current_portion_debt',
  ]);
  const cash = value(report, 'cash_and_equivalents');
  const assets = value(report, 'total_assets');
  const debt = interestBearingDebt(report);
  const restricted = value(report, 'restricted_cash');
  const base = dimMeta(id)?.severityBase ?? 70;

  if (cash === undefined || assets === undefined || debt === undefined || assets <= 0) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }

  const cashRatio = cash / assets;
  const debtRatioVal = debt / assets;
  const signal =
    cashRatio >= FOCUS_THRESHOLDS.cashToAssets &&
    debtRatioVal >= FOCUS_THRESHOLDS.interestBearingToAssets;

  if (!signal) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }

  let conclusion = `货币资金 ${yi(cash)} 亿元（占总资产 ${pct1(cashRatio)}%），同时有息负债 ${yi(debt)} 亿元（占总资产 ${pct1(debtRatioVal)}%）。`;
  if (restricted !== undefined && Number.isFinite(restricted)) {
    conclusion += `其中受限 ${yi(restricted)} 亿元。`;
  }
  return card(id, 'signal', conclusion, cites, base);
}

function evalGoodwill(report: Report): FocusHighlightCard {
  const id = 'goodwill_load';
  const cites = citesOf(report, ['goodwill', 'equity_parent']);
  const gw = value(report, 'goodwill');
  const eq = value(report, 'equity_parent');
  const base = dimMeta(id)?.severityBase ?? 65;

  if (gw === undefined || eq === undefined || eq <= 0) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }
  if (gw / eq < FOCUS_THRESHOLDS.goodwillToEquityParent) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }
  return card(
    id,
    'signal',
    `商誉 ${yi(gw)} 亿元，约占归母权益 ${pct1(gw / eq)}%。`,
    cites,
    base + Math.min(15, Math.floor((gw / eq) * 30)),
  );
}

function evalRestrictedCash(report: Report): FocusHighlightCard {
  const id = 'restricted_cash';
  const cites = citesOf(report, ['restricted_cash', 'cash_and_equivalents']);
  const cash = value(report, 'cash_and_equivalents');
  const restricted = value(report, 'restricted_cash');
  const base = dimMeta(id)?.severityBase ?? 60;

  if (cash === undefined || restricted === undefined || cash <= 0) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }
  const share = restricted / cash;
  if (share < FOCUS_THRESHOLDS.restrictedToCash) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }
  return card(
    id,
    'signal',
    `受限货币资金 ${yi(restricted)} 亿元，占货币资金 ${pct1(share)}%。`,
    cites,
    base + Math.min(15, Math.floor(share * 30)),
  );
}

function evalShortDebt(report: Report): FocusHighlightCard {
  const id = 'short_debt_pressure';
  const cites = citesOf(report, [
    'short_term_borrowings',
    'current_portion_debt',
    'cash_and_equivalents',
  ]);
  const short = shortInterestBearing(report);
  const total = interestBearingDebt(report);
  const cash = value(report, 'cash_and_equivalents');
  const base = dimMeta(id)?.severityBase ?? 68;

  if (short === undefined || total === undefined || total <= 0 || cash === undefined) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }
  const share = short / total;
  const cover = short > 0 ? cash / short : Infinity;
  const signal =
    share >= FOCUS_THRESHOLDS.shortDebtShare && cover < FOCUS_THRESHOLDS.cashToShortDebt;
  if (!signal) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }
  return card(
    id,
    'signal',
    `短期有息负债 ${yi(short)} 亿元，占有息负债 ${pct1(share)}%；货币资金对其覆盖约 ${ratioText(cover)} 倍。`,
    cites,
    base,
  );
}

function evalMarginCollapse(report: Report, previous?: Report | null): FocusHighlightCard {
  const id = 'margin_collapse';
  const cites = citesOf(report, ['revenue', 'net_profit', 'operating_cost']);
  const base = dimMeta(id)?.severityBase ?? 75;
  if (!previous) {
    return card(id, 'insufficient', '缺上期可比，暂无法判断', cites);
  }
  const rev = value(report, 'revenue');
  const prevRev = value(previous, 'revenue');
  const profit = value(report, 'net_profit');
  const prevProfit = value(previous, 'net_profit');
  const cost = value(report, 'operating_cost');
  const prevCost = value(previous, 'operating_cost');

  if (rev === undefined || prevRev === undefined || prevRev <= 0) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }

  const revUp = rev > prevRev;
  const profitDown =
    profit !== undefined && prevProfit !== undefined && prevProfit > 0 && profit < prevProfit;

  let marginDrop = false;
  let marginNote = '';
  if (
    cost !== undefined &&
    prevCost !== undefined &&
    rev > 0 &&
    prevRev > 0
  ) {
    const gm = (rev - cost) / rev;
    const prevGm = (prevRev - prevCost) / prevRev;
    const dropPp = (prevGm - gm) * 100;
    if (dropPp >= FOCUS_THRESHOLDS.marginDropPp) {
      marginDrop = true;
      marginNote = `毛利率由 ${pct1(prevGm)}% 降至 ${pct1(gm)}%。`;
    }
  }

  if (!(revUp && (profitDown || marginDrop))) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }

  let conclusion = `营业收入 ${yi(rev)} 亿元（上期 ${yi(prevRev)} 亿元）`;
  if (profit !== undefined && prevProfit !== undefined) {
    conclusion += `，归母净利润 ${yi(profit)} 亿元（上期 ${yi(prevProfit)} 亿元）`;
  }
  conclusion += `。${marginNote}`;
  return card(id, 'signal', conclusion.trim(), cites, base + (profitDown ? 8 : 0));
}

function evalOneOffBoost(report: Report): FocusHighlightCard {
  const id = 'one_off_boost';
  const cites = citesOf(report, ['non_recurring_pnl', 'profit_ex_non_recurring', 'net_profit']);
  const nr = value(report, 'non_recurring_pnl');
  const parent = value(report, 'net_profit');
  const ex = value(report, 'profit_ex_non_recurring');
  const base = dimMeta(id)?.severityBase ?? 78;

  if (parent === undefined || ex === undefined) {
    return card(id, 'insufficient', '相关数据不足，暂无法判断', cites);
  }

  const exNegative = parent > 0 && ex < 0;
  const highShare =
    nr !== undefined && parent > 0 && nr / parent >= FOCUS_THRESHOLDS.nonRecurringToParentProfit;
  if (!exNegative && !highShare) {
    return card(id, 'none', '未发现需要关注的情况', cites);
  }

  let conclusion = `归母净利润 ${yi(parent)} 亿元，扣非净利润 ${yi(ex)} 亿元。`;
  if (nr !== undefined) {
    conclusion += `非经常性损益 ${yi(nr)} 亿元。`;
  }
  return card(id, 'signal', conclusion, cites, base + (exNegative ? 12 : 0));
}

/** Parse「数字 + 万元」near expense/labor labels; flag absurd scale vs revenue. */
export function scanUnitAnomalies(
  pages: FocusPage[] | undefined,
  revenueYuan: number | undefined,
): FocusHighlightCard {
  const id = 'unit_anomaly';
  const base = dimMeta(id)?.severityBase ?? 100;
  if (!pages?.length) {
    return card(id, 'insufficient', '原文页未就绪，暂无法判断', []);
  }

  const labelRe =
    /劳务外包|外包报酬|外包费用|外包支出|外包服务|职工薪酬|应付职工|销售费用|管理费用|研发费用|财务费用|营业成本|原材料|采购款/;
  const amountRe = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{6,}(?:\.\d+)?)\s*万元/g;
  const hits: { page: number; raw: string; yuan: number; quote: string }[] = [];

  for (const p of pages) {
    const text = (p.content || '').replace(/\s+/g, ' ');
    if (!text) continue;
    // Prefer windows that contain a sensitive label.
    const windows: string[] = [];
    for (let i = 0; i < text.length; ) {
      const slice = text.slice(i, i + 240);
      if (labelRe.test(slice)) windows.push(slice);
      i += 180;
    }
    const corpus = windows.length ? windows : [text];
    for (const chunk of corpus) {
      if (!labelRe.test(chunk) && windows.length) continue;
      amountRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = amountRe.exec(chunk))) {
        const raw = m[1].replace(/,/g, '');
        const wan = Number(raw);
        if (!Number.isFinite(wan) || wan <= 0) continue;
        const intDigits = raw.split('.')[0]!.length;
        const yuan = wan * 10_000;
        const vsRevenue =
          revenueYuan !== undefined &&
          revenueYuan > 0 &&
          yuan >= revenueYuan * FOCUS_THRESHOLDS.unitAnomalyVsRevenue;
        const absurdDigits = intDigits >= FOCUS_THRESHOLDS.unitAnomalyWanDigits;
        if (!vsRevenue && !absurdDigits) continue;
        const start = Math.max(0, m.index - 24);
        const quote = chunk.slice(start, Math.min(chunk.length, m.index + m[0].length + 12)).trim();
        hits.push({ page: p.page, raw: m[0], yuan, quote });
      }
    }
  }

  if (!hits.length) {
    return card(id, 'none', '未发现需要关注的情况', []);
  }

  hits.sort((a, b) => b.yuan - a.yuan);
  const top = hits[0]!;
  const cites: FocusCite[] = [{ page: top.page, quote: top.quote }];
  const vs =
    revenueYuan && revenueYuan > 0
      ? `，按字面单位约为营业收入的 ${ratioText(top.yuan / revenueYuan)} 倍`
      : '';
  const conclusion = `原文出现「${top.raw}」（约 ${yi(top.yuan)} 亿元量级）${vs}，与常见费用口径显著不符。`;
  return card(id, 'signal', conclusion, cites, base + 20);
}

function evalSoftPedal(pages: FocusPage[] | undefined): FocusHighlightCard {
  const id = 'soft_pedal_cues';
  const base = dimMeta(id)?.severityBase ?? 55;
  if (!pages?.length) {
    return card(id, 'insufficient', '原文页未就绪，暂无法判断', []);
  }
  const riskRe = /行政处罚|诉讼|仲裁|立案|监管关注|警示函|责令改正|非标意见|保留意见|无法表示意见|强调事项段|整改通知/;
  const softRe = /有所波动|阶段性|不排除|一定影响|总体可控|影响有限|积极应对|妥善处理/;
  for (const p of pages) {
    const text = (p.content || '').replace(/\s+/g, ' ');
    if (!riskRe.test(text) || !softRe.test(text)) continue;
    const riskHit = text.match(riskRe)?.[0] ?? '相关事项';
    const softHit = text.match(softRe)?.[0] ?? '';
    const idx = text.search(riskRe);
    const quote = text.slice(Math.max(0, idx - 10), Math.min(text.length, idx + 48)).trim();
    return card(
      id,
      'signal',
      `原文同时出现「${riskHit}」与淡化表述「${softHit}」等。`,
      [{ page: p.page, quote }],
      base,
    );
  }
  return card(id, 'none', '未发现需要关注的情况', []);
}

function defaultCard(id: string): FocusHighlightCard {
  return card(id, 'none', '暂无风险', []);
}

/** Exported for tests / UI: dimension catalog from watch-skills. */
export function listWatchDimensions(): WatchDimDef[] {
  return seed.dimensions.slice();
}

/**
 * Evaluate all watch dimensions, then keep at most 2 signal cards (severity desc).
 * If none signal, return the two default calm cards.
 */
export function buildFocusHighlights(
  report: Report,
  opts?: { previous?: Report | null; pages?: FocusPage[] },
): FocusHighlightCard[] {
  const previous = opts?.previous ?? null;
  const pages = opts?.pages;
  const revenue = value(report, 'revenue');

  const evaluated: FocusHighlightCard[] = [
    scanUnitAnomalies(pages, revenue),
    evalNonRecurring(report),
    evalCashVsProfit(report),
    evalCashAndDebt(report),
    evalGoodwill(report),
    evalRestrictedCash(report),
    evalShortDebt(report),
    evalMarginCollapse(report, previous),
    evalOneOffBoost(report),
    evalSoftPedal(pages),
  ];

  const signals = evaluated
    .filter((c) => c.status === 'signal')
    .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0) || a.id.localeCompare(b.id));

  const max = seed.maxDisplay ?? FOCUS_MAX_CARDS;
  if (signals.length > 0) {
    return signals.slice(0, max).map(({ severity: _s, ...rest }) => rest);
  }

  const defaults = seed.dimensions.filter((d) => d.default).slice(0, max);
  if (defaults.length) {
    return defaults.map((d) => defaultCard(d.id));
  }
  // Fallback if config missing defaults
  return [defaultCard('earnings_quality_scan'), defaultCard('balance_sheet_scan')].slice(0, max);
}
