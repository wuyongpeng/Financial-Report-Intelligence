/**
 * 披露排雷：基于已解析结构化指标的规则提示（提示不下结论）。
 * 进概览自动计算；无命中时由 UI 隐藏或显示「本报告未触发关注项」。
 */
import {
  cashConversion,
  debtRatio,
  format,
  grossMargin,
  labels,
  period,
  value,
  type MetricName,
  type Report,
} from './detail-model';

export type DisclosureFlag = {
  id: string;
  /** 卡片短标题 */
  title: string;
  /** 现象：数字 + 报告期（页码由 UI 用 metric 跳 PDF） */
  phenomenon: string;
  /** 为何值得看：一句中性机制 */
  why: string;
  /** 可选去哪查 */
  where: string;
  metric?: MetricName;
  /** live = 本轮已接真实数据；todo = 占位，终审可演示结构但不自动命中 */
  status: 'live' | 'todo';
};

export type DisclosureYoyInput = {
  metric: MetricName;
  pct?: number;
  label?: string;
};

const SHARP_DROP_PCT = -15;
const MARGIN_DROP_PP = -2;
const CASH_COVER_PCT = 80;
const LEVERAGE_PCT = 70;

/**
 * 根据本期结构化指标生成排雷卡片。只输出 live 命中；todo 规则不进列表（UI 不渲染空壳）。
 */
export function buildDisclosureFlags(opts: {
  selected: Report;
  previous?: Report | null;
  yoyMoves?: DisclosureYoyInput[];
}): DisclosureFlag[] {
  const { selected, previous, yoyMoves = [] } = opts;
  const periodLabel = period(selected);
  const out: DisclosureFlag[] = [];

  // —— live 1：营收/归母净利同比大幅下行 ——
  for (const move of yoyMoves) {
    if (move.metric !== 'revenue' && move.metric !== 'net_profit') continue;
    if (move.pct === undefined || !Number.isFinite(move.pct) || move.pct > SHARP_DROP_PCT) continue;
    const current = value(selected, move.metric);
    const name = labels[move.metric];
    const pctText = `${move.pct.toFixed(1)}%`;
    out.push({
      id: `sharp-drop-${move.metric}`,
      title: `${name}同比明显下行`,
      phenomenon: `${periodLabel} ${name} ${format(current, move.metric)}，同比 ${move.label ?? pctText}`,
      why: '收入或利润端同比大幅走弱时，需核对口径是否可比，以及费用、非经常性损益是否同步变化。',
      where: '可对照利润表「营业收入 / 归母净利润」附注与管理层讨论分析中的变动说明。',
      metric: move.metric,
      status: 'live',
    });
  }

  // —— live 2：经营现金流相对利润偏弱 ——
  const cash = cashConversion(selected);
  if (cash !== undefined && cash < CASH_COVER_PCT) {
    const ocf = value(selected, 'operating_cash_flow');
    const profit = value(selected, 'net_profit');
    out.push({
      id: 'cash-vs-profit',
      title: '经营现金流弱于利润',
      phenomenon: `${periodLabel} 经营现金流净额 ${format(ocf, 'operating_cash_flow')}，仅覆盖归母净利润的 ${cash.toFixed(0)}%（净利 ${format(profit, 'net_profit')}）`,
      why: '利润与经营现金流背离时，常见于应收、存货或应付款节奏变化，值得核对现金含量。',
      where: '可对照现金流量表「经营活动产生的现金流量净额」与资产负债表应收/存货变动。',
      metric: 'operating_cash_flow',
      status: 'live',
    });
  }

  // —— live 3（有成本科目时）：毛利率较上期压缩 ——
  const gm = grossMargin(selected);
  const gmPrev = previous ? grossMargin(previous) : undefined;
  if (gm !== undefined && gmPrev !== undefined && gm - gmPrev <= MARGIN_DROP_PP) {
    const delta = gm - gmPrev;
    out.push({
      id: 'margin-compression',
      title: '毛利率较上期走弱',
      phenomenon: `${periodLabel} 毛利率 ${gm.toFixed(1)}%，较对比期 ${gmPrev.toFixed(1)}%（${delta.toFixed(1)} 个百分点）`,
      why: '毛利率下行可能来自产品结构、成本或定价变化，需结合分部与成本附注阅读。',
      where: '可对照利润表「营业成本」及附注中的成本构成、分部毛利。',
      metric: 'operating_cost',
      status: 'live',
    });
  }

  // —— live 4：资产负债率偏高（非银也可能触发，仅提示） ——
  const lev = debtRatio(selected);
  if (lev !== undefined && lev >= LEVERAGE_PCT) {
    out.push({
      id: 'high-leverage',
      title: '资产负债率偏高',
      phenomenon: `${periodLabel} 资产负债率 ${lev.toFixed(1)}%（负债 ${format(value(selected, 'total_liabilities'), 'total_liabilities')} ÷ 资产 ${format(value(selected, 'total_assets'), 'total_assets')}）`,
      why: '杠杆水平偏高时，需结合行业惯例看偿债压力与有息负债结构，不宜单独下结论。',
      where: '可对照资产负债表「负债合计 / 资产总计」及附注中的有息负债明细。',
      metric: 'total_liabilities',
      status: 'live',
    });
  }

  // 去重保序（同一 id 只留一条）
  const seen = new Set<string>();
  return out.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

/** 终审说明用：已接线 vs 占位规则（不自动出卡）。 */
export const DISCLOSURE_FLAG_RULE_STATUS = {
  live: [
    'sharp-drop-revenue / sharp-drop-net_profit：营收或归母净利同比 ≤ -15%',
    'cash-vs-profit：经营现金流 / 归母净利 < 80%（且净利>0）',
    'margin-compression：毛利率较对比期下降 ≥ 2 个百分点',
    'high-leverage：资产负债率 ≥ 70%',
  ],
  todo: [
    '商誉/减值大额变动（需附注结构化字段）',
    '关联交易占比异常（需附注结构化字段）',
    '审计意见非标（需意见字段）',
  ],
} as const;
