/**
 * 关键关系（v1）：程序发现跨指标勾稽，模型仅在「追问原因」时解释。
 * 不下投资结论、不恢复「重点关注」。
 */
import { formatYoyBadge, resolveYoy, describeYoy, yoyTone, type YoyResult } from './crawl-display';
import { FOCUS_THRESHOLDS } from './focus-highlights-config';
import {
  labels,
  value,
  resolveMetricPrior,
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

export type MetricRelationshipCard = {
  id: 'revenue_vs_profit' | 'cash_vs_profit' | 'profit_vs_ex_non_recurring';
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
   * insufficient — 三类均缺可比数据。
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

const ADVICE_BANNED =
  /投资建议|建议(?:减持|增持|买入|卖出|加仓|减仓)|目标价|买入|卖出|减持|增持|加仓|减仓|推荐(?:买入|卖出)/;

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
  const pages = cites.map((c) => `第 ${c.page} 页`).join('、');
  return `（出处：PDF ${pages}）`;
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

type EvalOutcome =
  | { kind: 'card'; card: MetricRelationshipCard }
  | { kind: 'none' }
  | { kind: 'insufficient' };

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
  if (divergence && revDir === 'up' && profitDir === 'down') {
    title = '收入增长没有转化为利润增长';
    howToRead = '收入规模扩大，但每单位收入对应的利润减少。';
    tone = 'watch';
  } else if (divergence && revDir === 'down' && profitDir === 'up') {
    title = '收入下滑但利润上升';
    howToRead = '利润改善并非由收入扩张驱动，需区分是费用收缩、一次性损益还是其他因素。';
    tone = 'watch';
  } else {
    title = '收入与利润同步增长';
    howToRead = '收入扩张与利润增长方向一致，规模扩大的同时盈利也在增加。';
    tone = 'ok';
  }

  const reasonBoundary =
    '仅凭这组数字不能判断是成本、费用还是其他损益变化；原因待核验，需核对原文。';

  const askPrompt = assertNoAdvice(
    `${title}。${facts.join('')}` +
      `请结合原文解释可能原因，并引用出处页码。${pageHint(cites)}` +
      `不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`,
  );

  return {
    kind: 'card',
    card: {
      id: 'revenue_vs_profit',
      title,
      facts: facts.map(assertNoAdvice),
      howToRead: assertNoAdvice(howToRead),
      reasonBoundary: assertNoAdvice(reasonBoundary),
      numbers: [
        numRow(report, 'revenue', `${yi(revenue)} 亿元 · ${revBadge}`),
        numRow(report, 'net_profit', `${yi(profit)} 亿元 · ${profitBadge}`),
      ],
      cites,
      askPrompt,
      tone,
    },
  };
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

  const hasCross =
    priorProfit !== undefined && priorOcf !== undefined;

  let notable = false;
  let title = '';
  let howToRead = '';
  let tone: 'watch' | 'ok' = 'watch';

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
      } else if (pDir === 'up' && cDir === 'down') {
        title = '盈利与经营现金流走势分化';
        howToRead = '利润增长没有伴随经营现金流同步改善，值得进一步核查。';
      } else if (pDir === 'down' && cDir === 'up') {
        title = '利润下滑但经营现金流改善';
        howToRead = '现金创造与账面利润走势不一致，需对照营运资本与原文解释。';
      } else {
        title = '经营现金流相对利润明显走弱';
        howToRead = '净现比跨期下降，利润与经营现金流的匹配程度变差。';
      }
    } else if (bothUp) {
      notable = true;
      tone = 'ok';
      title = '利润增长伴随经营现金流改善';
      howToRead = '利润与经营现金流同向改善，现金创造与账面盈利方向一致。';
    }
  } else {
    // 无上期：退回本期静态弱匹配（复用净现比阈值）
    const weak =
      (profit > 0 && ocf < 0) ||
      (ratio !== undefined && Number.isFinite(ratio) && ratio < thr);
    if (weak) {
      notable = true;
      tone = 'watch';
      title =
        profit > 0 && ocf < 0
          ? '账面盈利但经营现金流为负'
          : '经营现金流相对利润偏弱';
      howToRead =
        profit > 0 && ocf < 0
          ? '利润为正而经营现金流净额为负，利润与现金创造暂时不同步。'
          : `本期净现比偏低（经营现金流 / 归母净利润），现金转化弱于利润账面。`;
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

  const askPrompt = assertNoAdvice(
    `${title}。${facts.join('')}` +
      `请结合原文解释利润与经营现金流为何可能出现这种关系，并引用出处页码。` +
      `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`,
  );

  const ratioLabel =
    ratio !== undefined && Number.isFinite(ratio) ? ` · 净现比 ${ratioText(ratio)}` : '';

  return {
    kind: 'card',
    card: {
      id: 'cash_vs_profit',
      title,
      facts: facts.map(assertNoAdvice),
      howToRead: assertNoAdvice(howToRead),
      reasonBoundary: assertNoAdvice(reasonBoundary),
      numbers: [
        numRow(report, 'net_profit', `${yi(profit)} 亿元`),
        numRow(report, 'operating_cash_flow', `${yi(ocf)} 亿元${ratioLabel}`),
      ],
      cites,
      askPrompt,
      tone,
    },
  };
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

  // 扣非被误标成非经常性时 nr≈parent → 纠正
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

  const askPrompt = assertNoAdvice(
    `${title}。${facts.join('')}` +
      `请结合原文说明非经常性损益主要构成，并引用出处页码。` +
      `${pageHint(cites)}不要给出买卖或持仓建议；没有原文依据时请写明原因待核验。`,
  );

  const numbers: MetricRelNumber[] = [
    numRow(report, 'net_profit', `${yi(parent)} 亿元`),
  ];
  if (ex !== undefined) {
    numbers.push(numRow(report, 'profit_ex_non_recurring', `${yi(ex)} 亿元`));
  } else if (citeFor(report, 'non_recurring_pnl')) {
    numbers.push(numRow(report, 'non_recurring_pnl', `${yi(nr)} 亿元`));
  }

  return {
    kind: 'card',
    card: {
      id: 'profit_vs_ex_non_recurring',
      title,
      facts: facts.map(assertNoAdvice),
      howToRead: assertNoAdvice(howToRead),
      reasonBoundary: assertNoAdvice(reasonBoundary),
      numbers,
      cites,
      askPrompt,
      tone: 'watch',
    },
  };
}

export type BuildMetricRelationshipsOpts = {
  previous?: Report | null;
  preferDisclosedYoy?: boolean;
  maxCards?: number;
};

/**
 * 程序发现关键关系；UI 始终可展示本结果（有卡 / 已检查无背离 / 缺可比数据）。
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
  ];

  const cards: MetricRelationshipCard[] = [];
  let checked = 0;
  let insuff = 0;
  for (const o of outcomes) {
    if (o.kind === 'card') cards.push(o.card);
    else if (o.kind === 'none') checked += 1;
    else insuff += 1;
  }

  const sliced = cards.slice(0, max);
  if (sliced.length > 0) {
    return { cards: sliced, status: 'has_cards' };
  }
  if (checked > 0) {
    return { cards: [], status: 'checked_none' };
  }
  // 全部 insufficient，或没有任何可检查结果
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
