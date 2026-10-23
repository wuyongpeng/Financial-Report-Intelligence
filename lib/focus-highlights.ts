/**
 * 重点关注：固定 4 张卡片。只陈述事实与对比，不下结论、不评级。
 * 数字由代码填入模板；模型不参与计算。
 */
import { value, type MetricName, type Report } from './detail-model';
import { FOCUS_THRESHOLDS } from './focus-highlights-config';

export type FocusHighlightStatus = 'signal' | 'none' | 'insufficient';

export type FocusCite = {
  page: number;
  quote: string;
  metric?: MetricName;
};

export type FocusHighlightCard = {
  id: 'non_recurring' | 'cash_vs_profit' | 'cash_and_debt' | 'other';
  title: string;
  status: FocusHighlightStatus;
  conclusion: string;
  cites: FocusCite[];
};

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
  return metrics
    .map((m) => citeFor(report, m))
    .filter((c): c is FocusCite => Boolean(c));
}

/**
 * 有息负债 ≈ 短期借款 + 长期借款 + 应付债券 + 一年内到期的非流动负债。
 * 一年内到期项若只能拿到合计，先用全额近似（见 current_portion_debt 标签）。
 */
function interestBearingDebt(report: Report): number | undefined {
  const parts = [
    value(report, 'short_term_borrowings'),
    value(report, 'long_term_borrowings'),
    value(report, 'bonds_payable'),
    value(report, 'current_portion_debt'),
  ];
  if (parts.every((p) => p === undefined)) return undefined;
  return parts.reduce<number>((sum, p) => sum + (p ?? 0), 0);
}

function cardNonRecurring(report: Report): FocusHighlightCard {
  const id = 'non_recurring' as const;
  const title = '非经常性损益';
  const cites = citesOf(report, ['non_recurring_pnl', 'profit_ex_non_recurring', 'net_profit']);
  const nr = value(report, 'non_recurring_pnl');
  const parent = value(report, 'net_profit');
  const ex = value(report, 'profit_ex_non_recurring');

  if (parent === undefined || nr === undefined) {
    return {
      id,
      title,
      status: 'insufficient',
      conclusion: '财报未披露相关数据，暂无法判断',
      cites,
    };
  }

  const thr = FOCUS_THRESHOLDS.nonRecurringToParentProfit;
  const highShare = parent > 0 && nr / parent >= thr;
  const exNegative = parent > 0 && ex !== undefined && ex < 0;

  if (!highShare && !exNegative) {
    return {
      id,
      title,
      status: 'none',
      conclusion: '未发现需要关注的情况',
      cites,
    };
  }

  let conclusion = `非经常性损益 ${yi(nr)} 亿元，占归母净利润 ${pct1(nr / parent)}%。`;
  if (exNegative && ex !== undefined) {
    conclusion += `扣非净利润为 ${yi(ex)} 亿元。`;
  }
  return { id, title, status: 'signal', conclusion, cites };
}

function cardCashVsProfit(report: Report): FocusHighlightCard {
  const id = 'cash_vs_profit' as const;
  const title = '利润与经营现金流';
  const cites = citesOf(report, ['net_profit', 'operating_cash_flow']);
  const profit = value(report, 'net_profit');
  const ocf = value(report, 'operating_cash_flow');

  if (profit === undefined || ocf === undefined) {
    return {
      id,
      title,
      status: 'insufficient',
      conclusion: '财报未披露相关数据，暂无法判断',
      cites,
    };
  }

  const thr = FOCUS_THRESHOLDS.cashToProfitRatio;
  const ratio = profit !== 0 ? ocf / profit : undefined;
  const signal =
    (profit > 0 && ocf < 0) ||
    (ratio !== undefined && Number.isFinite(ratio) && ratio < thr);

  if (!signal) {
    return {
      id,
      title,
      status: 'none',
      conclusion: '未发现需要关注的情况',
      cites,
    };
  }

  const ratioPart =
    ratio !== undefined && Number.isFinite(ratio) ? ratioText(ratio) : '—';
  return {
    id,
    title,
    status: 'signal',
    conclusion: `净利润 ${yi(profit)} 亿元，经营现金流净额 ${yi(ocf)} 亿元，净现比 ${ratioPart}。`,
    cites,
  };
}

function cardCashAndDebt(report: Report): FocusHighlightCard {
  const id = 'cash_and_debt' as const;
  const title = '存贷情况';
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

  if (cash === undefined || assets === undefined || debt === undefined || assets <= 0) {
    return {
      id,
      title,
      status: 'insufficient',
      conclusion: '财报未披露相关数据，暂无法判断',
      cites,
    };
  }

  const cashRatio = cash / assets;
  const debtRatioVal = debt / assets;
  const signal =
    cashRatio >= FOCUS_THRESHOLDS.cashToAssets &&
    debtRatioVal >= FOCUS_THRESHOLDS.interestBearingToAssets;

  if (!signal) {
    return {
      id,
      title,
      status: 'none',
      conclusion: '未发现需要关注的情况',
      cites,
    };
  }

  let conclusion = `货币资金 ${yi(cash)} 亿元（占总资产 ${pct1(cashRatio)}%），同时有息负债 ${yi(debt)} 亿元（占总资产 ${pct1(debtRatioVal)}%）。`;
  if (restricted !== undefined && Number.isFinite(restricted)) {
    conclusion += `其中受限 ${yi(restricted)} 亿元。`;
  }
  return { id, title, status: 'signal', conclusion, cites };
}

function cardOther(_report: Report, _previous?: Report | null): FocusHighlightCard {
  // 承诺 / 处罚 / 股东 / 分红：暂无结构化字段，跳过。
  // 商誉：缺「近 2 年减值」字段，整类跳过，避免假装查过。
  return {
    id: 'other',
    title: '其它关注',
    status: 'none',
    conclusion: '无',
    cites: [],
  };
}

/** 永远返回恰好 4 张卡，顺序固定。 */
export function buildFocusHighlights(
  report: Report,
  opts?: { previous?: Report | null },
): FocusHighlightCard[] {
  return [
    cardNonRecurring(report),
    cardCashVsProfit(report),
    cardCashAndDebt(report),
    cardOther(report, opts?.previous),
  ];
}
