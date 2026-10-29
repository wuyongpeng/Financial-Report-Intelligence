/**
 * 指标联动：程序发现跨指标勾稽；概览只读展示数据与提示，原因可由右侧自行追问。
 * 不下投资结论、不恢复「重点关注」。
 * 规则约 10 类；展示上限 MAX_CARDS，按关注度排序并做主题去重。
 */
import { formatYoyBadge, resolveYoy, describeYoy, yoyTone, type YoyResult } from './crawl-display';
import { FOCUS_THRESHOLDS } from './focus-highlights-config';
import {
  labels,
  value,
  resolveMetricPrior,
  profitBridge,
  type MetricName,
  type Report,
} from './detail-model';

export type MetricRelCite = {
  page: number;
  quote: string;
  metric?: MetricName;
};

export type MetricRelNumber = {
  metric: MetricName;
  label: string;
  valueText: string;
  page?: number;
};

export type MetricRelId =
  | 'revenue_vs_profit'
  | 'cash_vs_profit'
  | 'profit_vs_ex_non_recurring'
  | 'revenue_cost_margin'
  | 'profit_bridge'
  | 'debt_vs_assets'
  | 'restricted_cash_share'
  | 'goodwill_vs_equity'
  | 'assets_vs_revenue_growth'
  | 'revenue_ocf_rate';

export type MetricRelationshipCard = {
  id: MetricRelId;
  /** 关系标题（陈述关系，非警报口号） */
  title: string;
  /** 事实行：含两期数字与推导比率 */
  facts: string[];
  /** 怎么看：算术关系一句 */
  howToRead: string;
  /** 原因边界：无原文时写待核验，禁止因果断言 */
  reasonBoundary: string;
  numbers: MetricRelNumber[];
  cites: MetricRelCite[];
  askPrompt: string;
  /** watch=背离/弱匹配；ok=同步改善（理解向，非排雷） */
  tone: 'watch' | 'ok';
};

export type MetricRelationshipsResult = {
  cards: MetricRelationshipCard[];
  /**
   * has_cards — 有 1～3 张卡；
   * checked_none — 已检查且无明显背离/值得列出的同步；
   * insufficient — 已注册关系均缺可比数据。
   */
  status: 'has_cards' | 'checked_none' | 'insufficient';
};

const YI = 1e8;
const MAX_CARDS = 3;
/** 营收×净利「同步增长」最低同比（百分点），避免轻微波动刷卡 */
const SYNC_GROWTH_MIN_YOY = 5;
/** 净现比跨期恶化：上期尚可、本期跌破阈值，或绝对降幅 */
const CASH_RATIO_PRIOR_OK = 0.8;
const CASH_RATIO_DROP = 0.5;
/** 资产负债率（负债/资产）偏高 */
const DEBT_RATIO_HIGH = 0.7;
/** 资产负债率跨期变动（百分点） */
const DEBT_RATIO_CHANGE_PP = 5;
/** 经营现金流率（OCF/营收）跨期恶化（百分点） */
const OCF_RATE_DROP_PP = 3;
/** 总资产增速相对营收增速过快（百分点） */
const ASSET_OVER_REV_PP = 10;
/** 利润桥：利润变动相对上期利润的最小幅度，过小不出卡 */
const BRIDGE_MIN_PROFIT_MOVE = 0.05;

const ADVICE_BANNED =
  /投资建议|建议(?:减持|增持|买入|卖出|加仓|减仓)|目标价|买入|卖出|减持|增持|加仓|减仓|推荐(?:买入|卖出)/;

type Theme =
  | 'growth'
  | 'cash'
  | 'earnings_quality'
  | 'leverage'
  | 'liquidity'
  | 'goodwill'
  | 'expansion';

type RankedCard = {
  card: MetricRelationshipCard;
  priority: number;
  theme: Theme;
};

type EvalOutcome =
  | { kind: 'card'; ranked: RankedCard }
  | { kind: 'none' }
  | { kind: 'insufficient' };

function yi(n: number): string {
  return (n / YI).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct1(n: number): string {
  return (n * 100).toLocaleString('zh-CN', {
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
  const pages = cites.map((c) => `[P${c.page}]`).join('、');
  return `（出处：${pages}）`;
}

function assertNoAdvice(text: string): string {
  if (ADVICE_BANNED.test(text)) {
    throw new Error(`metric-relationships: banned advice wording: ${text}`);
  }
  return text;
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

function priorValue(
  report: Report,
  previous: Report | null | undefined,
  metric: MetricName,
): number | undefined {
  const current = value(report, metric);
  const row = report.metrics.find((m) => m.metric === metric);
  return resolveMetricPrior(current, {
    disclosedPrior: row?.prior_value,
    disclosedYoyPct: row?.yoy_pct,
    crossReportPrior: previous ? value(previous, metric) : undefined,
  });
}

function yoyDirection(yoy: YoyResult | undefined): 'up' | 'down' | null {
  if (!yoy) return null;
  const tone = yoyTone(yoy);
  if (tone === 'up' || tone === 'down') return tone;
  return null;
}

function levelDir(curr: number, prior: number): 'up' | 'down' | 'flat' {
  if (curr > prior) return 'up';
  if (curr < prior) return 'down';
  return 'flat';
}

function changeVerb(curr: number, prior: number): '增至' | '降至' | '仍为' {
  if (curr > prior) return '增至';
  if (curr < prior) return '降至';
  return '仍为';
}

function numRow(
  report: Report,
  metric: MetricName,
  valueText: string,
): MetricRelNumber {
  return {
    metric,
    label: labels[metric],
    valueText,
    page: citeFor(report, metric)?.page,
  };
}

function makeCard(
  card: MetricRelationshipCard,
  priority: number,
  theme: Theme,
): EvalOutcome {
  return {
    kind: 'card',
    ranked: {
      card: {
        ...card,
        facts: card.facts.map(assertNoAdvice),
        howToRead: assertNoAdvice(card.howToRead),
        reasonBoundary: assertNoAdvice(card.reasonBoundary),
        askPrompt: assertNoAdvice(card.askPrompt),
        title: assertNoAdvice(card.title),
      },
      priority,
      theme,
    },
  };
}

function evalRevenueVsProfit(
  report: Report,
  previous: Report | null | undefined,
  preferDisclosed: boolean,
): EvalOutcome {
  const revenue = value(report, 'revenue');
  const profit = value(report, 'net_profit');
  if (revenue === undefined || profit === undefined) return { kind: 'insufficient' };

  const revYoy = resolveMetricYoy(report, previous, 'revenue', preferDisclosed);
  const profitYoy = resolveMetricYoy(report, previous, 'net_profit', preferDisclosed);
  const revDir = yoyDirection(revYoy);
  const profitDir = yoyDirection(profitYoy);
  if (!revDir || !profitDir) return { kind: 'insufficient' };

  const priorRev = priorValue(report, previous, 'revenue');
  const priorProfit = priorValue(report, previous, 'net_profit');

  const divergence = revDir !== profitDir;
  const syncGrowth =
    revDir === 'up' &&
    profitDir === 'up' &&
    (revYoy?.pct ?? 0) >= SYNC_GROWTH_MIN_YOY &&
    (profitYoy?.pct ?? 0) >= SYNC_GROWTH_MIN_YOY;

  if (!divergence && !syncGrowth) return { kind: 'none' };

  const revBadge = formatYoyBadge(revYoy, 1);
  const profitBadge = formatYoyBadge(profitYoy, 1);
  const cites = citesOf(report, ['revenue', 'net_profit']);

  const facts: string[] = [];
  if (priorRev !== undefined && priorProfit !== undefined) {
    facts.push(
      `营收由 ${yi(priorRev)} 亿${changeVerb(revenue, priorRev)} ${yi(revenue)} 亿，` +
        `归母净利润由 ${yi(priorProfit)} 亿${changeVerb(profit, priorProfit)} ${yi(profit)} 亿。`,
    );
    if (priorRev > 0 && revenue > 0) {
      const priorMargin = priorProfit / priorRev;
      const currMargin = profit / revenue;
      facts.push(
        `对应的归母净利率由 ${pct1(priorMargin)}% ${changeVerb(currMargin, priorMargin)}约 ${pct1(currMargin)}%` +
          `（归母净利率 = 归母净利润 / 营收，不是毛利率）。`,
      );
    }
  } else {
    facts.push(
      `营业收入本期 ${yi(revenue)} 亿元（同比 ${revBadge}），` +
        `归母净利润本期 ${yi(profit)} 亿元（同比 ${profitBadge}）。`,
    );
    if (revenue > 0) {
      facts.push(
        `本期归母净利率约 ${pct1(profit / revenue)}%（归母 / 营收，不是毛利率）。`,
      );
    }
  }

  let title: string;
  let howToRead: string;
  let tone: 'watch' | 'ok';
  let priority: number;
  if (divergence && revDir === 'up' && profitDir === 'down') {
    title = '收入增长没有转化为利润增长';
    howToRead = '收入规模扩大，但每单位收入对应的利润减少。';
    tone = 'watch';
    priority = 95;
  } else if (divergence && revDir === 'down' && profitDir === 'up') {
    title = '收入下滑但利润上升';
    howToRead = '利润改善并非由收入扩张驱动，需区分是费用收缩、一次性损益还是其他因素。';
    tone = 'watch';
    priority = 90;
  } else {
    title = '收入与利润同步增长';
    howToRead = '收入扩张与利润增长方向一致，规模扩大的同时盈利也在增加。';
    tone = 'ok';
    priority = 35;
  }

  const reasonBoundary =
    '仅凭这组数字不能判断是成本、费用还是其他损益变化；原因待核验，需核对原文。';

  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释可能原因，并引用出处页码。${pageHint(cites)}` +
    `不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'revenue_vs_profit',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'revenue', `${yi(revenue)} 亿元 · ${revBadge}`),
        numRow(report, 'net_profit', `${yi(profit)} 亿元 · ${profitBadge}`),
      ],
      cites,
      askPrompt,
      tone,
    },
    priority,
    'growth',
  );
}

function evalCashVsProfit(
  report: Report,
  previous: Report | null | undefined,
): EvalOutcome {
  const profit = value(report, 'net_profit');
  const ocf = value(report, 'operating_cash_flow');
  if (profit === undefined || ocf === undefined) return { kind: 'insufficient' };

  const thr = FOCUS_THRESHOLDS.cashToProfitRatio;
  const ratio = profit !== 0 ? ocf / profit : undefined;
  const priorProfit = previous ? value(previous, 'net_profit') : undefined;
  const priorOcf = previous ? value(previous, 'operating_cash_flow') : undefined;
  const priorRatio =
    priorProfit !== undefined && priorProfit !== 0 && priorOcf !== undefined
      ? priorOcf / priorProfit
      : undefined;

  const hasCross = priorProfit !== undefined && priorOcf !== undefined;

  let notable = false;
  let title = '';
  let howToRead = '';
  let tone: 'watch' | 'ok' = 'watch';
  let priority = 0;

  if (hasCross) {
    const pDir = levelDir(profit, priorProfit!);
    const cDir = levelDir(ocf, priorOcf!);
    const crossDiverge =
      (pDir === 'up' && cDir === 'down') || (pDir === 'down' && cDir === 'up');
    const bothUp = pDir === 'up' && cDir === 'up';
    const ratioCollapse =
      priorRatio !== undefined &&
      ratio !== undefined &&
      Number.isFinite(ratio) &&
      Number.isFinite(priorRatio) &&
      ((priorRatio >= CASH_RATIO_PRIOR_OK && ratio < thr) ||
        priorRatio - ratio >= CASH_RATIO_DROP);
    const profitPosOcfNeg = profit > 0 && ocf < 0;

    if (crossDiverge || ratioCollapse || profitPosOcfNeg) {
      notable = true;
      tone = 'watch';
      if (profitPosOcfNeg) {
        title = '账面盈利但经营现金流为负';
        howToRead = '利润为正而经营现金流净额为负，利润与现金创造暂时不同步。';
        priority = 98;
      } else if (pDir === 'up' && cDir === 'down') {
        title = '盈利与经营现金流走势分化';
        howToRead = '利润增长没有伴随经营现金流同步改善，值得进一步核查。';
        priority = 92;
      } else if (pDir === 'down' && cDir === 'up') {
        title = '利润下滑但经营现金流改善';
        howToRead = '现金创造与账面利润走势不一致，需对照营运资本与原文解释。';
        priority = 88;
      } else {
        title = '经营现金流相对利润明显走弱';
        howToRead = '净现比跨期下降，利润与经营现金流的匹配程度变差。';
        priority = 88;
      }
    } else if (bothUp) {
      notable = true;
      tone = 'ok';
      title = '利润增长伴随经营现金流改善';
      howToRead = '利润与经营现金流同向改善，现金创造与账面盈利方向一致。';
      priority = 40;
    }
  } else {
    const weak =
      (profit > 0 && ocf < 0) ||
      (ratio !== undefined && Number.isFinite(ratio) && ratio < thr);
    if (weak) {
      notable = true;
      tone = 'watch';
      if (profit > 0 && ocf < 0) {
        title = '账面盈利但经营现金流为负';
        howToRead = '利润为正而经营现金流净额为负，利润与现金创造暂时不同步。';
        priority = 98;
      } else {
        title = '经营现金流相对利润偏弱';
        howToRead = '本期净现比偏低（经营现金流 / 归母净利润），现金转化弱于利润账面。';
        priority = 82;
      }
    }
  }

  if (!notable) return { kind: 'none' };

  const cites = citesOf(report, ['net_profit', 'operating_cash_flow']);
  const facts: string[] = [];
  if (hasCross) {
    facts.push(
      `归母净利润由 ${yi(priorProfit!)} 亿${changeVerb(profit, priorProfit!)} ${yi(profit)} 亿，` +
        `经营现金流由 ${yi(priorOcf!)} 亿${changeVerb(ocf, priorOcf!)} ${yi(ocf)} 亿。`,
    );
    if (
      priorRatio !== undefined &&
      ratio !== undefined &&
      Number.isFinite(priorRatio) &&
      Number.isFinite(ratio)
    ) {
      facts.push(
        `经营现金流与归母净利润的比值由 ${pct1(priorRatio)}% ${changeVerb(ratio, priorRatio)} ${pct1(ratio)}%。`,
      );
    }
  } else {
    const ratioPart =
      ratio !== undefined && Number.isFinite(ratio) ? ratioText(ratio) : '—';
    facts.push(
      `归母净利润 ${yi(profit)} 亿元，经营现金流净额 ${yi(ocf)} 亿元` +
        (ratio !== undefined && Number.isFinite(ratio)
          ? `，净现比 ${ratioPart}。`
          : '。'),
    );
  }

  const reasonBoundary =
    '不能据此直接断言「客户不付款」或「利润造假」；需检查应收、存货、付款节奏及原文解释。原因待核验。';

  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释利润与经营现金流为何可能出现这种关系，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  const ratioLabel =
    ratio !== undefined && Number.isFinite(ratio) ? ` · 净现比 ${ratioText(ratio)}` : '';

  return makeCard(
    {
      id: 'cash_vs_profit',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'net_profit', `${yi(profit)} 亿元`),
        numRow(report, 'operating_cash_flow', `${yi(ocf)} 亿元${ratioLabel}`),
      ],
      cites,
      askPrompt,
      tone,
    },
    priority,
    'cash',
  );
}

function resolveNonRecurring(report: Report): {
  parent: number;
  ex: number | undefined;
  nr: number;
} | null {
  let nr = value(report, 'non_recurring_pnl');
  const parent = value(report, 'net_profit');
  const ex = value(report, 'profit_ex_non_recurring');
  if (parent === undefined) return null;

  if (
    nr !== undefined &&
    parent > 0 &&
    Math.abs(nr - parent) / parent < 0.02
  ) {
    if (ex !== undefined) nr = parent - ex;
    else return null;
  }

  if (nr === undefined) {
    if (ex !== undefined) nr = parent - ex;
    else return null;
  }

  return { parent, ex, nr };
}

function evalProfitVsExNonRecurring(report: Report): EvalOutcome {
  const resolved = resolveNonRecurring(report);
  if (!resolved) return { kind: 'insufficient' };
  const { parent, ex, nr } = resolved;

  const thr = FOCUS_THRESHOLDS.nonRecurringToParentProfit;
  const highShare = parent > 0 && nr / parent >= thr;
  const exNegative = parent > 0 && ex !== undefined && ex < 0;
  if (!highShare && !exNegative) return { kind: 'none' };

  const cites = citesOf(report, [
    'net_profit',
    'profit_ex_non_recurring',
    'non_recurring_pnl',
  ]);

  const title = exNegative
    ? '扣非后净利润为负'
    : '归母净利润含较高非经常性损益';

  const facts: string[] = [
    `归母净利润 ${yi(parent)} 亿元` +
      (ex !== undefined ? `，扣非净利润 ${yi(ex)} 亿元` : '') +
      `，非经常性损益约 ${yi(nr)} 亿元。`,
  ];
  if (parent > 0) {
    facts.push(`非经常性损益约占归母净利润 ${pct1(nr / parent)}%。`);
  }

  const howToRead = exNegative
    ? '扣非后盈利显著弱于归母口径，经常性业务贡献偏弱或为负。'
    : '归母利润中有较大一部分来自非经常性项目，阅读时常需与扣非口径对照。';

  const reasonBoundary =
    '不能仅凭占比高低断言业绩「注水」或可持续性；须核对非经常性损益明细与原文。原因待核验。';

  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文说明非经常性损益主要构成，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  const numbers: MetricRelNumber[] = [
    numRow(report, 'net_profit', `${yi(parent)} 亿元`),
  ];
  if (ex !== undefined) {
    numbers.push(numRow(report, 'profit_ex_non_recurring', `${yi(ex)} 亿元`));
  } else if (citeFor(report, 'non_recurring_pnl')) {
    numbers.push(numRow(report, 'non_recurring_pnl', `${yi(nr)} 亿元`));
  }

  return makeCard(
    {
      id: 'profit_vs_ex_non_recurring',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers,
      cites,
      askPrompt,
      tone: 'watch',
    },
    exNegative ? 96 : 80,
    'earnings_quality',
  );
}

/** 03 营收 × 营业成本 × 毛利率 */
function evalRevenueCostMargin(
  report: Report,
  previous: Report | null | undefined,
): EvalOutcome {
  const revenue = value(report, 'revenue');
  const cost = value(report, 'operating_cost');
  const priorRev = priorValue(report, previous, 'revenue');
  const priorCost = priorValue(report, previous, 'operating_cost');
  if (
    revenue === undefined ||
    cost === undefined ||
    priorRev === undefined ||
    priorCost === undefined ||
    revenue <= 0 ||
    priorRev <= 0
  ) {
    return { kind: 'insufficient' };
  }

  const gm = (revenue - cost) / revenue;
  const prevGm = (priorRev - priorCost) / priorRev;
  const dropPp = (prevGm - gm) * 100;
  const costFaster =
    priorCost > 0 &&
    cost / priorCost - 1 > revenue / priorRev - 1 + 0.03;

  if (dropPp < FOCUS_THRESHOLDS.marginDropPp && !costFaster) {
    return { kind: 'none' };
  }

  const cites = citesOf(report, ['revenue', 'operating_cost']);
  const title =
    dropPp >= FOCUS_THRESHOLDS.marginDropPp
      ? '毛利率明显收窄'
      : '营业成本增速快于营收';
  const facts = [
    `营收由 ${yi(priorRev)} 亿${changeVerb(revenue, priorRev)} ${yi(revenue)} 亿，` +
      `营业成本由 ${yi(priorCost)} 亿${changeVerb(cost, priorCost)} ${yi(cost)} 亿。`,
    `毛利率由 ${pct1(prevGm)}% ${changeVerb(gm, prevGm)} ${pct1(gm)}%` +
      `（毛利率 = (营收 − 营业成本) / 营收）。`,
  ];
  const howToRead =
    '成本相对收入抬升，单位收入留下的毛利变少；这是算术关系，不等于已证明涨价或产品结构原因。';
  const reasonBoundary =
    '不能仅凭毛利率变动断言涨价失败、成本失控或行业衰退；须核对原文成本构成。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释成本与毛利变化可能原因，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  const priority =
    78 + Math.min(12, Math.max(0, Math.floor(dropPp - FOCUS_THRESHOLDS.marginDropPp)));

  return makeCard(
    {
      id: 'revenue_cost_margin',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'revenue', `${yi(revenue)} 亿元`),
        numRow(report, 'operating_cost', `${yi(cost)} 亿元`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    priority,
    'growth',
  );
}

/** 05 收入变化 × 净利率变化 × 利润变化（利润桥） */
function evalProfitBridge(
  report: Report,
  previous: Report | null | undefined,
): EvalOutcome {
  const revenue = value(report, 'revenue');
  const profit = value(report, 'net_profit');
  const priorRev = priorValue(report, previous, 'revenue');
  const priorProfit = priorValue(report, previous, 'net_profit');
  if (
    revenue === undefined ||
    profit === undefined ||
    priorRev === undefined ||
    priorProfit === undefined
  ) {
    return { kind: 'insufficient' };
  }

  const bridge = profitBridge(revenue, profit, priorRev, priorProfit);
  if (!bridge) return { kind: 'insufficient' };

  const dProfit = profit - priorProfit;
  if (Math.abs(priorProfit) > 0 && Math.abs(dProfit) / Math.abs(priorProfit) < BRIDGE_MIN_PROFIT_MOVE) {
    return { kind: 'none' };
  }
  if (dProfit === 0) return { kind: 'none' };

  const { revenueEffect, marginEffect } = bridge;
  const marginDominates =
    Math.abs(marginEffect) >= Math.abs(revenueEffect) * 1.15 &&
    Math.abs(marginEffect) >= Math.abs(dProfit) * 0.4;
  const opposing =
    Math.sign(revenueEffect) !== 0 &&
    Math.sign(marginEffect) !== 0 &&
    Math.sign(revenueEffect) !== Math.sign(marginEffect);
  const profitDownMarginDrag = dProfit < 0 && marginEffect < 0;

  // 只在结构上有看点时出卡：利润率主导、规模与利润率反向、或利润下滑且利润率拖累
  if (!marginDominates && !opposing && !profitDownMarginDrag) {
    return { kind: 'none' };
  }

  const cites = citesOf(report, ['revenue', 'net_profit']);
  const priorMargin = priorProfit / priorRev;
  const currMargin = profit / revenue;
  let title: string;
  let howToRead: string;
  let priority: number;
  if (dProfit < 0 && marginEffect < 0 && (marginDominates || opposing)) {
    title = '利润下滑中利润率拖累更明显';
    howToRead = '按两因子分解，利润率变化对利润变动的贡献大于或对冲了规模因素。';
    priority = 86;
  } else if (dProfit > 0 && marginEffect < 0 && opposing) {
    title = '规模扩大但利润率拖累利润';
    howToRead = '收入扩张带来的利润贡献被利润率下降部分抵消。';
    priority = 84;
  } else if (marginDominates) {
    title = '利润变动更多来自利润率变化';
    howToRead = '两因子分解显示利润率效应大于规模效应；这是数学贡献，不是经营因果证明。';
    priority = 76;
  } else {
    title = '规模与利润率对利润的贡献方向相反';
    howToRead = '收入规模效应与利润率效应一正一负，净结果需结合两边幅度阅读。';
    priority = 74;
  }

  const facts = [
    `归母净利润由 ${yi(priorProfit)} 亿${changeVerb(profit, priorProfit)} ${yi(profit)} 亿` +
      `（变动 ${yi(dProfit)} 亿）。`,
    `粗略分解：规模效应约 ${yi(revenueEffect)} 亿，利润率效应约 ${yi(marginEffect)} 亿` +
      `；归母净利率由 ${pct1(priorMargin)}% ${changeVerb(currMargin, priorMargin)} ${pct1(currMargin)}%。`,
  ];
  const reasonBoundary =
    '利润桥只做两因子算术分解，不能当作成本、费用或一次性损益的原因证明。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释规模与利润率变化，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'profit_bridge',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'revenue', `${yi(revenue)} 亿元`),
        numRow(report, 'net_profit', `${yi(profit)} 亿元`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    priority,
    'growth',
  );
}

/** 41 总负债 × 总资产 */
function evalDebtVsAssets(
  report: Report,
  previous: Report | null | undefined,
): EvalOutcome {
  const assets = value(report, 'total_assets');
  const liab = value(report, 'total_liabilities');
  if (assets === undefined || liab === undefined || assets <= 0) {
    return { kind: 'insufficient' };
  }
  const ratio = liab / assets;
  const priorAssets = previous ? value(previous, 'total_assets') : undefined;
  const priorLiab = previous ? value(previous, 'total_liabilities') : undefined;
  const priorRatio =
    priorAssets !== undefined && priorAssets > 0 && priorLiab !== undefined
      ? priorLiab / priorAssets
      : undefined;
  const changePp =
    priorRatio !== undefined ? (ratio - priorRatio) * 100 : undefined;

  const high = ratio >= DEBT_RATIO_HIGH;
  const jumped = changePp !== undefined && changePp >= DEBT_RATIO_CHANGE_PP;
  if (!high && !jumped) return { kind: 'none' };

  const cites = citesOf(report, ['total_liabilities', 'total_assets']);
  const title = jumped && (!high || (changePp ?? 0) >= 8)
    ? '资产负债率明显上升'
    : '资产负债率处于较高水平';
  const facts: string[] = [
    `负债合计 ${yi(liab)} 亿元，资产总计 ${yi(assets)} 亿元，资产负债率约 ${pct1(ratio)}%。`,
  ];
  if (priorRatio !== undefined && priorAssets !== undefined && priorLiab !== undefined) {
    facts.push(
      `上期资产负债率约 ${pct1(priorRatio)}%` +
        `（负债 ${yi(priorLiab)} 亿 / 资产 ${yi(priorAssets)} 亿）。`,
    );
  }
  const howToRead = '杠杆水平由负债与资产的比值描述；升高表示单位资产对应的负债更多。';
  const reasonBoundary =
    '不能仅凭比率高低断言偿债危机或融资扩张意图；须结合债务结构与原文。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文说明负债与资产变化，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'debt_vs_assets',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'total_liabilities', `${yi(liab)} 亿元`),
        numRow(report, 'total_assets', `${yi(assets)} 亿元 · 资产负债率 ${pct1(ratio)}%`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    high && jumped ? 85 : high ? 82 : 78,
    'leverage',
  );
}

/** 43 受限货币资金 × 货币资金 */
function evalRestrictedCashShare(report: Report): EvalOutcome {
  const cash = value(report, 'cash_and_equivalents');
  const restricted = value(report, 'restricted_cash');
  if (cash === undefined || restricted === undefined || cash <= 0) {
    return { kind: 'insufficient' };
  }
  const share = restricted / cash;
  if (share < FOCUS_THRESHOLDS.restrictedToCash) return { kind: 'none' };

  const cites = citesOf(report, ['restricted_cash', 'cash_and_equivalents']);
  const title = '货币资金中受限占比较高';
  const facts = [
    `受限货币资金 ${yi(restricted)} 亿元，货币资金 ${yi(cash)} 亿元，受限占比约 ${pct1(share)}%。`,
  ];
  const howToRead = '账面现金并不全部可随时动用；受限部分需对照披露用途阅读。';
  const reasonBoundary =
    '不能仅凭占比断言流动性危机；须核对受限原因与原文。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文说明受限资金用途，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'restricted_cash_share',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'restricted_cash', `${yi(restricted)} 亿元`),
        numRow(report, 'cash_and_equivalents', `${yi(cash)} 亿元 · 受限占比 ${pct1(share)}%`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    70 + Math.min(15, Math.floor(share * 30)),
    'liquidity',
  );
}

/** 55 商誉 × 归母权益 */
function evalGoodwillVsEquity(report: Report): EvalOutcome {
  const gw = value(report, 'goodwill');
  const eq = value(report, 'equity_parent');
  if (gw === undefined || eq === undefined || eq <= 0) {
    return { kind: 'insufficient' };
  }
  const share = gw / eq;
  if (share < FOCUS_THRESHOLDS.goodwillToEquityParent) return { kind: 'none' };

  const cites = citesOf(report, ['goodwill', 'equity_parent']);
  const title = '商誉相对归母权益体量较大';
  const facts = [
    `商誉 ${yi(gw)} 亿元，归母权益 ${yi(eq)} 亿元，约占 ${pct1(share)}%。`,
  ];
  const howToRead = '商誉相对权益的占比描述并购形成的账面体量；占比高不等于已经减值。';
  const reasonBoundary =
    '不能仅凭占比断言商誉减值或收购失败；须核对收购业绩与原文。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文说明商誉来源与相关披露，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'goodwill_vs_equity',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'goodwill', `${yi(gw)} 亿元`),
        numRow(report, 'equity_parent', `${yi(eq)} 亿元 · 商誉占比 ${pct1(share)}%`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    72 + Math.min(15, Math.floor(share * 30)),
    'goodwill',
  );
}

/** 51 总资产增长 × 营收增长 */
function evalAssetsVsRevenueGrowth(
  report: Report,
  previous: Report | null | undefined,
  preferDisclosed: boolean,
): EvalOutcome {
  const assets = value(report, 'total_assets');
  const revenue = value(report, 'revenue');
  if (assets === undefined || revenue === undefined) return { kind: 'insufficient' };

  const assetYoy = resolveMetricYoy(report, previous, 'total_assets', preferDisclosed);
  const revYoy = resolveMetricYoy(report, previous, 'revenue', preferDisclosed);
  const aDir = yoyDirection(assetYoy);
  const rDir = yoyDirection(revYoy);
  if (!aDir || !rDir || assetYoy?.pct === undefined || revYoy?.pct === undefined) {
    return { kind: 'insufficient' };
  }

  const gap = assetYoy.pct - revYoy.pct;
  const diverge =
    (aDir === 'up' && rDir === 'down') ||
    (aDir === 'up' && rDir === 'up' && gap >= ASSET_OVER_REV_PP) ||
    (aDir === 'up' && revYoy.pct < 2 && assetYoy.pct >= ASSET_OVER_REV_PP);

  if (!diverge) return { kind: 'none' };

  const priorAssets = priorValue(report, previous, 'total_assets');
  const priorRev = priorValue(report, previous, 'revenue');
  const cites = citesOf(report, ['total_assets', 'revenue']);
  const assetBadge = formatYoyBadge(assetYoy, 1);
  const revBadge = formatYoyBadge(revYoy, 1);

  const title =
    aDir === 'up' && rDir === 'down'
      ? '资产扩张但营收下滑'
      : '资产扩张快于营收增长';
  const facts: string[] = [];
  if (priorAssets !== undefined && priorRev !== undefined) {
    facts.push(
      `总资产由 ${yi(priorAssets)} 亿${changeVerb(assets, priorAssets)} ${yi(assets)} 亿（同比 ${assetBadge}），` +
        `营收由 ${yi(priorRev)} 亿${changeVerb(revenue, priorRev)} ${yi(revenue)} 亿（同比 ${revBadge}）。`,
    );
  } else {
    facts.push(
      `总资产本期 ${yi(assets)} 亿元（同比 ${assetBadge}），` +
        `营业收入本期 ${yi(revenue)} 亿元（同比 ${revBadge}）。`,
    );
  }
  const howToRead = '资产规模扩张快于业务收入增长时，单位资产带来的收入变少。';
  const reasonBoundary =
    '不能仅凭增速差断言盲目扩张或产能闲置；须核对投资与原文。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释资产与收入增长差异，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'assets_vs_revenue_growth',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'total_assets', `${yi(assets)} 亿元 · ${assetBadge}`),
        numRow(report, 'revenue', `${yi(revenue)} 亿元 · ${revBadge}`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    aDir === 'up' && rDir === 'down' ? 88 : 80,
    'expansion',
  );
}

/** 14 营收 × 经营现金流率 */
function evalRevenueOcfRate(
  report: Report,
  previous: Report | null | undefined,
): EvalOutcome {
  const revenue = value(report, 'revenue');
  const ocf = value(report, 'operating_cash_flow');
  if (revenue === undefined || ocf === undefined || revenue <= 0) {
    return { kind: 'insufficient' };
  }
  const rate = ocf / revenue;
  const priorRev = previous ? value(previous, 'revenue') : undefined;
  const priorOcf = previous ? value(previous, 'operating_cash_flow') : undefined;
  if (priorRev === undefined || priorOcf === undefined || priorRev <= 0) {
    return { kind: 'insufficient' };
  }
  const priorRate = priorOcf / priorRev;
  const dropPp = (priorRate - rate) * 100;
  const revUp = revenue > priorRev;
  const rateDown = rate < priorRate;

  // 与 cash_vs_profit 互补：看「每单位收入的现金」，需有实质恶化
  if (dropPp < OCF_RATE_DROP_PP && !(revUp && rateDown && dropPp >= 1.5)) {
    return { kind: 'none' };
  }

  const cites = citesOf(report, ['revenue', 'operating_cash_flow']);
  const title =
    revUp && rateDown
      ? '营收增长但经营现金流率下降'
      : '经营现金流率明显走弱';
  const facts = [
    `营收由 ${yi(priorRev)} 亿${changeVerb(revenue, priorRev)} ${yi(revenue)} 亿，` +
      `经营现金流由 ${yi(priorOcf)} 亿${changeVerb(ocf, priorOcf)} ${yi(ocf)} 亿。`,
    `经营现金流率（经营现金流 / 营收）由 ${pct1(priorRate)}% ${changeVerb(rate, priorRate)} ${pct1(rate)}%。`,
  ];
  const howToRead = '每单位收入对应的经营现金净额下降，收入扩张与现金创造不同步。';
  const reasonBoundary =
    '不能仅凭现金流率下降断言回款恶化；须核对营运资本与原文。原因待核验。';
  const askPrompt =
    `${title}。${facts.join('')}` +
    `请结合原文解释收入与经营现金流率变化，并引用出处页码。` +
    `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`;

  return makeCard(
    {
      id: 'revenue_ocf_rate',
      title,
      facts,
      howToRead,
      reasonBoundary,
      numbers: [
        numRow(report, 'revenue', `${yi(revenue)} 亿元`),
        numRow(report, 'operating_cash_flow', `${yi(ocf)} 亿元 · 现金流率 ${pct1(rate)}%`),
      ],
      cites,
      askPrompt,
      tone: 'watch',
    },
    revUp && rateDown ? 84 : 78,
    'cash',
  );
}

function selectCards(ranked: RankedCard[], max: number): MetricRelationshipCard[] {
  const byTheme = new Map<Theme, RankedCard>();
  const sorted = [...ranked].sort((a, b) => b.priority - a.priority);
  for (const item of sorted) {
    const prev = byTheme.get(item.theme);
    if (!prev || item.priority > prev.priority) {
      byTheme.set(item.theme, item);
    }
  }
  return [...byTheme.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max)
    .map((r) => r.card);
}

export type BuildMetricRelationshipsOpts = {
  previous?: Report | null;
  preferDisclosedYoy?: boolean;
  maxCards?: number;
};

/**
 * 程序发现关键关系；UI 始终可展示本结果（有卡 / 已检查无背离 / 缺可比数据）。
 * 多规则命中时按关注度排序并主题去重，最多返回 maxCards 张。
 */
export function buildMetricRelationships(
  report: Report,
  opts: BuildMetricRelationshipsOpts = {},
): MetricRelationshipsResult {
  const previous = opts.previous ?? null;
  const preferDisclosed = opts.preferDisclosedYoy !== false;
  const max = opts.maxCards ?? MAX_CARDS;

  const outcomes: EvalOutcome[] = [
    evalRevenueVsProfit(report, previous, preferDisclosed),
    evalCashVsProfit(report, previous),
    evalProfitVsExNonRecurring(report),
    evalRevenueCostMargin(report, previous),
    evalProfitBridge(report, previous),
    evalDebtVsAssets(report, previous),
    evalRestrictedCashShare(report),
    evalGoodwillVsEquity(report),
    evalAssetsVsRevenueGrowth(report, previous, preferDisclosed),
    evalRevenueOcfRate(report, previous),
  ];

  const ranked: RankedCard[] = [];
  let checked = 0;
  let insuff = 0;
  for (const o of outcomes) {
    if (o.kind === 'card') ranked.push(o.ranked);
    else if (o.kind === 'none') checked += 1;
    else insuff += 1;
  }

  const sliced = selectCards(ranked, max);
  if (sliced.length > 0) {
    return { cards: sliced, status: 'has_cards' };
  }
  if (checked > 0) {
    return { cards: [], status: 'checked_none' };
  }
  return { cards: [], status: 'insufficient' };
}

/** 测试用：结论是否含投资建议禁用词 */
export function containsInvestmentAdvice(text: string): boolean {
  return ADVICE_BANNED.test(text);
}

export const METRIC_REL_EMPTY = {
  checked_none: '已检查的关系未发现明显背离',
  insufficient: '缺少可比数据，暂无法判断',
} as const;

/** UI section labels — swap TAKE only when product renames the second block. */
export const RELATION_DATA_LABEL = '数据' as const;
/** Provisional product name for the interpretive block (not 结论 / 怎么看). */
export const RELATION_TAKE_LABEL = '提示' as const;

/** 已注册关系检测器数量（含展示上限内的排序/去重）。 */
export const METRIC_REL_DETECTOR_COUNT = 10;
