import { parseAuditOpinionPages, emptyAuditOpinion, type ParsedAuditOpinion } from './audit-opinion';

export const parsedMetricNames = [
  'revenue', 'net_profit', 'eps', 'roe', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost',
  'non_recurring_pnl', 'profit_ex_non_recurring',
  'cash_and_equivalents', 'restricted_cash',
  'short_term_borrowings', 'long_term_borrowings', 'bonds_payable', 'current_portion_debt',
  'goodwill', 'equity_parent',
] as const;
export const PARSE_PAGE_LIMIT = 120;
/** pdf.js loads the whole file; above this, extract the first pages from disk instead. */
export const PDFJS_PARSE_MAX_BYTES = 50 * 1024 * 1024;

export function shouldExtractTextExternally(byteLength: number) {
  return byteLength > PDFJS_PARSE_MAX_BYTES;
}
// Currency rows share one scaling path; ratios and per-share values must not be scaled.
const currencyMetrics = new Set([
  'revenue', 'net_profit', 'total_assets', 'total_liabilities', 'operating_cash_flow', 'operating_cost',
  'non_recurring_pnl', 'profit_ex_non_recurring',
  'cash_and_equivalents', 'restricted_cash',
  'short_term_borrowings', 'long_term_borrowings', 'bonds_payable', 'current_portion_debt',
  'goodwill', 'equity_parent',
]);

export type ParsedMetric = {
  metric: typeof parsedMetricNames[number];
  value: number;
  unit: string;
  page: number;
  sourceLabel: string;
  confidence: number;
  /** 上年同期金额（与 value 同单位缩放），来自摘要表第二列 */
  priorValue?: number;
  /** 财报披露的同比增减（%），括号为负；不对百分比做千元缩放 */
  yoyPct?: number;
};

type MetricDefinition = {
  metric: ParsedMetric['metric'];
  labels: string[];
  unit: string;
  minAbs: number;
  maxAbs: number;
};

type Candidate = ParsedMetric & { score: number };

const LABELS: MetricDefinition[] = [
  { metric: 'revenue', labels: ['营业总收入', '营业收入'], unit: '元', minAbs: 1000, maxAbs: 1e15 },
  { metric: 'net_profit', labels: [
    '归属于上市公司普通股股东的净利润',
    '归属于上市公司股东的净利润',
    '归属于母公司所有者的净利润',
    '归属于母公司股东的净利润',
    '归属于本行股东的净利润',
    '归属于本公司股东的净利润',
  ], unit: '元', minAbs: 1, maxAbs: 1e15 },
  { metric: 'eps', labels: ['基本每股收益', '基本和稀释每股收益', '基本/稀释每股收益'], unit: '元/股', minAbs: 0, maxAbs: 1000 },
  { metric: 'roe', labels: [
    '归属于本行普通股股东的加权平均净资产收益率',
    '归属于本公司普通股股东的加权平均净资产收益率',
    '加权平均净资产收益率',
    '加权平均净资产收益',
    '净资产收益率（加权平均）',
    // 中行等银行摘要常用「净资产收益率（%）」而无「加权平均」字样（仍按年化加权口径披露）。
    '净资产收益率',
  ], unit: '%', minAbs: 0, maxAbs: 1000 },
  { metric: 'total_assets', labels: ['资产总计', '资产总额', '总资产'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
  { metric: 'total_liabilities', labels: ['负债合计', '负债总额'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
  // Operating cash flow is legitimately negative, so no lower bound on magnitude.
  { metric: 'operating_cash_flow', labels: ['经营活动产生的现金流量净额', '经营活动现金流量净额'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'operating_cost', labels: ['营业成本'], unit: '元', minAbs: 1000, maxAbs: 1e16 },
  { metric: 'non_recurring_pnl', labels: ['非经常性损益合计', '非经常性损益净额', '非经常性损益'], unit: '元', minAbs: 0, maxAbs: 1e15 },
  { metric: 'profit_ex_non_recurring', labels: [
    '扣除非经常性损益后归属于母公司所有者的净利润',
    '扣除非经常性损益后归属于母公司股东的净利润',
    '扣除非经常性损益后归属于上市公司普通股股东的净利润',
    '扣除非经常性损益后归属于上市公司股东的净利润',
    '扣除非经常性损益后归属于本公司股东的净利润',
    '扣除非经常性损益后归属于本行股东的净利润',
    '扣除非经常性损益后的净利润',
    '归属于上市公司普通股股东的扣除非经常性损益的净利润',
    '归属于上市公司股东的扣除非经常性损益的净利润',
    '归属于母公司股东的扣除非经常性损益的净利润',
    '归属于本行股东的扣除非经常性损益的净利润',
    '扣非后归属于上市公司股东的净利润',
    '扣非后归属于母公司股东的净利润',
    '扣非后归属于本行股东的净利润',
  ], unit: '元', minAbs: 0, maxAbs: 1e15 },
  { metric: 'cash_and_equivalents', labels: ['货币资金'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'restricted_cash', labels: ['受限货币资金', '使用受限的货币资金', '受限制的货币资金'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'short_term_borrowings', labels: ['短期借款'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'long_term_borrowings', labels: ['长期借款'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'bonds_payable', labels: ['应付债券'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  // Approximation: full line item when finer借款/债券 split is unavailable.
  { metric: 'current_portion_debt', labels: ['一年内到期的非流动负债'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'goodwill', labels: ['商誉'], unit: '元', minAbs: 0, maxAbs: 1e16 },
  { metric: 'equity_parent', labels: ['归属于母公司股东的权益', '归属于母公司所有者权益', '归属于上市公司股东的净资产', '归属于本公司股东权益合计'], unit: '元', minAbs: 0, maxAbs: 1e16 },
];

function pageCurrencyUnit(text: string) {
  // Prefer explicit 单位：… (incl. 单位：百万元人民币). Do NOT let EPS cell notes
  // like （人民币元） override a table-level 百万元/千元.
  return text.match(/单位\s*[：:]\s*(?:人民币\s*)?(亿元|百万元|万元|千元|元)/)?.[1]
    ?? text.match(/[（(]\s*人民币\s*(亿元|百万元|万元|千元)\s*(?:列示|除外)?/)?.[1]
    ?? text.match(/人民币\s*(亿元|百万元|万元|千元)(?!\s*元)/)?.[1]
    ?? '';
}

/** Unit written into the metric key itself, e.g. 营业收入（千元） / 营业收入(万元). */
function labelCurrencyUnit(afterLabel: string) {
  const head = afterLabel.slice(0, 48);
  return head.match(/^\s*[（(]\s*(?:人民币\s*)?(亿元|百万元|万元|千元|元)\s*[)）]/)?.[1]
    ?? head.match(/^\s*[：:]\s*(?:人民币\s*)?(亿元|百万元|万元|千元|元)(?!\s*\/)/)?.[1]
    ?? '';
}

function isMoneyUnit(unit: string) {
  return unit === '亿元' || unit === '百万元' || unit === '万元' || unit === '千元' || unit === '元';
}

/**
 * Amount rows store 元. Priority: unit in metric name > unit on the number > table default.
 * On conflict, trust the metric-name unit and warn. EPS/ROE never call this path.
 */
function resolveCurrencyScaleUnit(input: {
  metric: string;
  sourceLabel: string;
  labelUnit: string;
  valueUnit: string;
  tableUnit: string;
}) {
  const valueUnit = isMoneyUnit(input.valueUnit) ? input.valueUnit : '';
  const tableUnit = isMoneyUnit(input.tableUnit) ? input.tableUnit : '';
  const labelUnit = isMoneyUnit(input.labelUnit) ? input.labelUnit : '';

  if (labelUnit && tableUnit && labelUnit !== tableUnit) {
    console.warn(`[parser] unit conflict for ${input.metric} (${input.sourceLabel}): label=${labelUnit} table=${tableUnit}; trusting label`);
  }
  if (labelUnit && valueUnit && labelUnit !== valueUnit) {
    console.warn(`[parser] unit conflict for ${input.metric} (${input.sourceLabel}): label=${labelUnit} value=${valueUnit}; trusting label`);
  }

  return labelUnit || valueUnit || tableUnit || '元';
}

function scaleCurrency(value: number, unit: string) {
  const scaled = unit === '亿元' ? value * 100000000
    : unit === '百万元' ? value * 1000000
    : unit === '万元' ? value * 10000
    : unit === '千元' ? value * 1000
    : value;
  return Math.round(scaled * 100) / 100;
}

/**
 * PDF text layers often wrap mid-amount: "40,476,58\n5,676.17" → 40,476,585,676.17.
 * Only join when a thousands-comma context makes a wrap unambiguous.
 */
function stitchBrokenAmounts(text: string) {
  return text
    .replace(/(\d),?\r?\n\s*,(\d)/g, '$1,$2')
    .replace(/(\d),\r?\n\s*(\d)/g, '$1,$2')
    .replace(/(,\d{1,2})\r?\n\s*(\d)/g, '$1$2')
    .replace(/(^|[\s（(])-\r?\n\s*(?=\d)/gm, '$1-');
}

function normalizePageText(text: string) {
  return stitchBrokenAmounts(text)
    .replace(/\s+/g, ' ')
    .replace(/([\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '$1')
    .trim();
}

function parseSignedNumber(raw: string, openParen?: string, closeParen?: string) {
  let value = Number(raw);
  if (!Number.isFinite(value)) return null;
  if (openParen && closeParen) value = -Math.abs(value);
  return value;
}

/** After the current-period cell, read optional 上年同期 + 同比增减 from the same row. */
function parseYoyPercentToken(text: string) {
  // A-share forms: 9.05% | (45.57%) | （45.57%） | (45.57)% 
  const match = text.match(/^\s*(?:\(\s*(-?\d+(?:\.\d+)?)\s*%\s*\)|(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%)/);
  if (!match) return null;
  if (match[1] !== undefined) {
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? { value: -Math.abs(parsed), length: match[0].length } : null;
  }
  const parsed = parseSignedNumber(match[3], match[2], match[4]);
  return parsed === null ? null : { value: parsed, length: match[0].length };
}

/** Maotai/Q3 summary: 本报告期 | 增减%(often bare) | 年初至报告期末 | … */
function looksLikeBareYoyThenYtd(currentRaw: number, bare: number, next: number) {
  const absCurrent = Math.abs(currentRaw);
  const absBare = Math.abs(bare);
  const absNext = Math.abs(next);
  // YoY column stays within ±1000; refuse amount-sized tokens.
  if (!(absBare < 1000)) return false;
  if (absCurrent >= 1000) {
    // Next cell should look like YTD / cumulative (≥ ~half of period amount).
    if (absNext < 1000) return false;
    if (absNext < absCurrent * 0.5) return false;
    // Bare is a percent, not a prior amount. Do NOT require bare ≪ 1% of current:
    // 百万元 rows with double-digit YoY (e.g. 2,167 | -29.67 | 6,739) must still match.
    if (absBare >= absCurrent * 0.5) return false;
    return true;
  }
  // EPS-scale: 本期 | 同比% | 年初至期末(≥本期) | …
  // Allow next ≈ current (YTD folded poorly) when bare looks percent-sized (茅台 15.35|0.77|…).
  // Same <1000 bar as amount rows — 兆易 6.00|689.47|15.83 was rejected by a 500 cap
  // and 689.47 was stored as prior → UI (6-689.47)/689.47 = -99.13%.
  if (!(absBare < 1000)) return false;
  // 银行摘要三年列 0.36|0.36|0.36：中间是上年同期 EPS，不是同比%。
  if (absCurrent > 0 && Math.abs(absBare - absCurrent) / absCurrent <= 0.08) return false;
  if (absNext < absCurrent * 0.85 && !(absBare <= 100 && absNext > absBare * 2)) return false;
  // Percent column often exceeds YTD absolute (0.60 | 15.13 | 1.76); prior EPS rarely does.
  if (absBare > absNext) return true;
  // CMB-style Q3: 1.59 | 3.25 | 4.57 | 3.16 — YTD ≈ 2–4× quarterly, bare is %.
  const ytdRatio = absNext / absCurrent;
  if (ytdRatio >= 1.0 && ytdRatio <= 5 && absBare <= 100) return true;
  return absNext > absBare * 2;
}

function parseTrailingPriorAndYoy(rest: string, currentRaw?: number) {
  let priorValue: number | undefined;
  let yoyPct: number | undefined;
  let cursor = rest;
  // CATL quarterly tables: 本报告期 | 同比增减% | 年初至报告期末 | …
  // Prefer an immediate % column so "58.58%" is not split into prior=58.5 + yoy=8%.
  const immediateYoy = parseYoyPercentToken(cursor);
  if (immediateYoy) {
    return { priorValue: undefined, yoyPct: immediateYoy.value };
  }
  // Maotai-style: YoY column is a bare number (header already says 增减幅度%), then YTD amount.
  // Must NOT treat that bare percent as an amount prior (net_profit minAbs=1 used to keep 3.78).
  if (currentRaw !== undefined && Number.isFinite(currentRaw)) {
    const bareMatch = cursor.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?(?![.\d]*\s*%)/);
    if (bareMatch) {
      const bare = parseSignedNumber(bareMatch[2], bareMatch[1], bareMatch[3]);
      if (bare !== null && Math.abs(bare) < 1000) {
        const afterBare = cursor.slice(bareMatch[0].length);
        // Classic 本期 | 上年同期 | 同比% — next token is percent, keep prior path.
        if (!parseYoyPercentToken(afterBare)) {
          const nextMatch = afterBare.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?/);
          if (nextMatch) {
            const next = parseSignedNumber(nextMatch[2], nextMatch[1], nextMatch[3]);
            if (next !== null && looksLikeBareYoyThenYtd(currentRaw, bare, next)) {
              return { priorValue: undefined, yoyPct: bare };
            }
          }
        }
      }
    }
  }
  // Restated prior: 上年同期下分「调整前」「调整后」, then 同比增减%.
  // Taking only the first prior leaves the duplicate column in the way of YoY
  // (新易盛 2025Q3 归母净利 prior 对但丢 205.38%), and for EPS/ROE the first
  // column is 调整前 while disclosed YoY uses 调整后 (1.1 vs 0.79).
  // 陕西煤业等摘要表头已写「增减变动幅度(%)」时单元格常省略 % 号（-20.91 非 -20.91%）。
  const dualPrior = cursor.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?(?![.\d]*\s*%)\s+(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?(?![.\d]*\s*%)/);
  if (dualPrior) {
    const pre = parseSignedNumber(dualPrior[2], dualPrior[1], dualPrior[3]);
    const post = parseSignedNumber(dualPrior[5], dualPrior[4], dualPrior[6]);
    const afterDual = cursor.slice(dualPrior[0].length);
    let yoyAfterDual = parseYoyPercentToken(afterDual);
    if (!yoyAfterDual && pre !== null && post !== null && currentRaw !== undefined && Number.isFinite(currentRaw)) {
      const bareYoyMatch = afterDual.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?(?![.\d]*\s*%)/);
      if (bareYoyMatch) {
        const bareYoy = parseSignedNumber(bareYoyMatch[2], bareYoyMatch[1], bareYoyMatch[3]);
        if (bareYoy !== null && Math.abs(bareYoy) < 1000) {
          const tol = 0.15 + Math.abs(bareYoy) * 0.002;
          // Prefer 调整后: YoY must reconcile to post first (用户：一律按调整后).
          if (post !== 0) {
            const yoyFromPost = ((currentRaw - post) / Math.abs(post)) * 100;
            if (Math.abs(yoyFromPost - bareYoy) <= tol) {
              return { priorValue: post, yoyPct: bareYoy };
            }
          }
          // 银行利润表：中间是变动额时同比贴合上年同期(pre)，不是调整后。
          if (pre !== 0) {
            const yoyFromPre = ((currentRaw - pre) / Math.abs(pre)) * 100;
            if (Math.abs(yoyFromPre - bareYoy) <= tol) {
              return { priorValue: pre, yoyPct: bareYoy };
            }
          }
        }
      }
    }
    if (pre !== null && post !== null && yoyAfterDual) {
      // 银行利润表：本期 | 上年同期 | 变动额 | 变动比率% — 变动额不是「调整后」。
      // 若同比%贴近 (本期−上年同期)/|上年同期|，保留上年同期为 prior。
      if (currentRaw !== undefined && Number.isFinite(currentRaw) && pre !== 0) {
        const yoyFromPre = ((currentRaw - pre) / Math.abs(pre)) * 100;
        if (Math.abs(yoyFromPre - yoyAfterDual.value) <= 0.15 + Math.abs(yoyAfterDual.value) * 0.002) {
          return { priorValue: pre, yoyPct: yoyAfterDual.value };
        }
      }
      return { priorValue: post, yoyPct: yoyAfterDual.value };
    }
  }
  // Prior amount: refuse prefixes of a percent token (58.5 from 58.58%).
  const priorMatch = cursor.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?(?![.\d]*\s*%)/);
  if (priorMatch) {
    const parsed = parseSignedNumber(priorMatch[2], priorMatch[1], priorMatch[3]);
    if (parsed !== null) {
      priorValue = parsed;
      cursor = cursor.slice(priorMatch[0].length);
    }
  }
  const yoy = parseYoyPercentToken(cursor);
  if (yoy) yoyPct = yoy.value;
  return { priorValue, yoyPct };
}

function candidateAfterLabel(pageText: string, label: string, definition: MetricDefinition, fallbackCurrencyUnit = '') {
  const index = pageText.indexOf(label);
  if (index < 0) return null;
  let nearby = pageText.slice(index + label.length, index + label.length + 220)
    .replace(/[,，]/g, '')
    .replace(/（/g, '(').replace(/）/g, ')')
    // Fullwidth percent / decimal from some PDF text layers (3.8％ / 3．8%).
    .replace(/％/g, '%')
    .replace(/．/g, '.');
  // Skip period stubs (e.g. 2026 年 7-9 月) so the first number is not a calendar year.
  nearby = nearby.replace(/^(?:\s*(?:20\d{2}|19\d{2})\s*年(?:\s*\d{1,2}\s*[-–—至到]\s*\d{1,2}\s*月)?)+/, ' ');
  const labelUnit = currencyMetrics.has(definition.metric) ? labelCurrencyUnit(nearby) : '';
  // Ratio/per-share rows often look like `基本每股收益（元/股）(1) 0.58`. Strip
  // small numeric footnotes anywhere before the real value. Parenthesized
  // currency amounts stay intact — those are negative values, not footnotes.
  if (!currencyMetrics.has(definition.metric)) {
    nearby = nearby
      // 元/股 or 人民币元 cell notes before the amount / footnote.
      .replace(/\(\s*(?:人民币\s*)?元(?:\s*\/?\s*股)?\s*\)/g, ' ')
      .replace(/\(\s*[1-9]\d{0,2}\s*\)/g, ' ')
      // Bare footnote without parens: `基本每股收益（元/股）1 0.58`.
      // Only strip when another numeric token follows so a lone integer EPS like `2` is kept.
      .replace(/(?:^|\s)([1-9]\d{0,2})(?=\s+-?\d+(?:\.\d+)?)/g, ' ');
  } else if (labelUnit) {
    // Drop `（千元）` from the key so the amount parser sees the number cleanly.
    nearby = nearby.replace(/^\s*\(\s*(?:人民币\s*)?(亿元|百万元|万元|千元|元)\s*\)/, ' ');
  }
  // ROE: unit often sits in the label as （%）/(%)/% with a bare period number.
  // Prefer that bare number; never take a later 同比/增减…% as ROE (Muxi 688802).
  if (definition.metric === 'roe') {
    const unitInLabel = /^\s*(?:\(%\)|%)(?!\d)/.test(nearby);
    const roeSearch = unitInLabel ? nearby.replace(/^\s*(?:\(%\)|%)\s*/, '') : nearby;

    const finishRoe = (value: number, after: string) => {
      if (!Number.isFinite(value)) return null;
      if (Math.abs(value) < definition.minAbs || Math.abs(value) > definition.maxAbs) return null;
      // Restated ROE: 本期 | 调整前 | 调整后 | 增减(百分点). Prefer 调整后 when
      // the third token matches |本期−调整后| (新易盛 20.81 | 12.45 | 6.81 | 14.00;
      // 陕西煤业 5.72 | 5.60 | 5.25 | 0.48). Must run before ppThenYtd — otherwise
      // 调整前≈本期 would look like「增减百分点 | 年初至期末」and drop prior.
      const dualRoe = after.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?\s+(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?\s+(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?/);
      if (dualRoe) {
        const pre = parseSignedNumber(dualRoe[2], dualRoe[1], dualRoe[3]);
        const post = parseSignedNumber(dualRoe[5], dualRoe[4], dualRoe[6]);
        const delta = parseSignedNumber(dualRoe[8], dualRoe[7], dualRoe[9]);
        if (
          pre !== null && post !== null && delta !== null
          && Math.abs(pre) <= definition.maxAbs
          && Math.abs(post) <= definition.maxAbs
        ) {
          const pp = Math.abs(value - post);
          if (Math.abs(pp - Math.abs(delta)) <= 0.05 + pp * 0.001 && Math.abs(delta) <= 80) {
            return { value, detectedUnit: '%', priorValue: post, yoyPct: undefined };
          }
        }
      }
      // ROE tables list 本期 then 上年同期 (same unit). A following bare/percent
      // number is prior level — not 同比增减 — unless a third % column appears.
      // Q3 summary ROE: 本期 | 增减百分点 | 年初至期末 | … (陕西煤业 5.80 0.07 16.70 2.95)
      const ppThenYtd = after.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?\s+(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?/);
      if (ppThenYtd) {
        const mid = parseSignedNumber(ppThenYtd[2], ppThenYtd[1], ppThenYtd[3]);
        const ytd = parseSignedNumber(ppThenYtd[5], ppThenYtd[4], ppThenYtd[6]);
        if (
          mid !== null && ytd !== null
          && Math.abs(ytd) >= Math.abs(value) * 0.5
          && Math.abs(mid) < Math.abs(value)
          && Math.abs(mid) <= 50
        ) {
          return { value, detectedUnit: '%', priorValue: undefined, yoyPct: undefined };
        }
      }
      const priorLevel = after.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?/);
      let priorValue: number | undefined;
      let yoyPct: number | undefined;
      if (priorLevel) {
        const parsed = parseSignedNumber(priorLevel[2], priorLevel[1], priorLevel[3]);
        const rest = after.slice(priorLevel[0].length);
        // Only when 百分点 hugs this token (「-0.18 个百分点」) is it a pp delta —
        // not prior ROE. Muxi-style「-2.62 增加7.15个百分点」keeps -2.62 as prior level.
        if (/^\s*个百分点/.test(rest)) {
          // leave prior / yoy empty
        } else if (parsed !== null && Math.abs(parsed) <= definition.maxAbs) {
          priorValue = parsed;
          // 「增加7.15个百分点」is a YoY description, not a % token — leave yoyPct empty.
          if (!/(?:百分点|同比|增减|较上年)/.test(rest.slice(0, 24))) {
            const yoy = parseYoyPercentToken(rest);
            if (yoy) yoyPct = yoy.value;
          }
        }
      }
      return { value, detectedUnit: '%', priorValue, yoyPct };
    };

    if (unitInLabel) {
      const bare = roeSearch.match(/^\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*%?/);
      if (bare) {
        const value = parseSignedNumber(bare[2], bare[1], bare[3]);
        if (value !== null) {
          return finishRoe(value, roeSearch.slice(bare[0].length));
        }
      }
    }

    const percentRe = /(-?\d+(?:\.\d+)?)\s*%/g;
    let percentMatch: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    while ((match = percentRe.exec(nearby)) !== null) {
      const before = nearby.slice(Math.max(0, match.index - 24), match.index);
      // Skip YoY / change / footnote prose after the label (e.g. 同比增长 44.67%).
      if (/(?:同比|较上年|增减|变动|变化|百分点|说明|注释)\s*$/.test(before)) continue;
      if (/(?:同比|较上年|增减|增加|减少|上升|下降|提高|降低)[^。；;\n]{0,16}$/.test(before)) continue;
      percentMatch = match;
      break;
    }
    if (percentMatch) {
      return finishRoe(Number(percentMatch[1]), nearby.slice(percentMatch.index + percentMatch[0].length));
    }
  }
  const valueMatch = nearby.match(/(?:人民币)?\s*(\()?\s*(-?\d+(?:\.\d+)?)\s*(\))?\s*(%|亿元|百万元|万元|千元|元\/股|元)?/);
  if (!valueMatch) return null;
  let value = parseSignedNumber(valueMatch[2], valueMatch[1], valueMatch[3]);
  if (value === null) return null;
  const currentRaw = value;
  const detectedUnit = valueMatch[4] ?? '';
  const tableUnit = fallbackCurrencyUnit || pageCurrencyUnit(pageText) || '';
  const scaleUnit = currencyMetrics.has(definition.metric)
    ? resolveCurrencyScaleUnit({
      metric: definition.metric,
      sourceLabel: label,
      labelUnit,
      valueUnit: detectedUnit,
      tableUnit,
    })
    : detectedUnit || tableUnit || '元';

  if (currencyMetrics.has(definition.metric)) {
    value = scaleCurrency(value, scaleUnit);
  }
  if (Math.abs(value) < definition.minAbs || Math.abs(value) > definition.maxAbs) return null;

  const afterFirst = nearby.slice(valueMatch.index! + valueMatch[0].length);
  // Pass unscaled current so Maotai bare YoY vs YTD heuristics compare PDF cells.
  const trailing = parseTrailingPriorAndYoy(afterFirst, currentRaw);
  let priorValue = trailing.priorValue;
  const yoyPct = trailing.yoyPct;
  if (priorValue !== undefined) {
    if (currencyMetrics.has(definition.metric)) {
      priorValue = scaleCurrency(priorValue, scaleUnit === '%' ? '元' : scaleUnit);
    }
    if (Math.abs(priorValue) < definition.minAbs || Math.abs(priorValue) > definition.maxAbs) {
      priorValue = undefined;
    }
  }
  return { value, detectedUnit: labelUnit || detectedUnit, priorValue, yoyPct };
}

function allLabelPositions(text: string, label: string) {
  const positions: number[] = [];
  let from = 0;
  while (from < text.length) {
    const position = text.indexOf(label, from);
    if (position < 0) break;
    positions.push(position);
    from = position + label.length;
  }
  return positions;
}

/**
 * Reject alias collisions:
 * - Short「非经常性损益」inside「扣除非经常性损益后…净利润」
 * -「归属于…股东的净利润」inside「扣除非经常性损益后归属于…净利润」(banks: 本行)
 */
function isCleanLabelHit(page: string, position: number, label: string, metric: MetricDefinition['metric']) {
  if (metric === 'non_recurring_pnl') {
    const before = page.slice(Math.max(0, position - 2), position);
    if (before === '扣除') return false;
    const after = page[position + label.length] ?? '';
    // 「…非经常性损益后归属于…」— the amount belongs to profit_ex_non_recurring.
    if (after === '后') return false;
    return true;
  }
  if (metric === 'net_profit') {
    const before = page.slice(Math.max(0, position - 28), position);
    if (/扣除非经常性损益后$/.test(before)) return false;
    if (/扣非后$/.test(before)) return false;
    return true;
  }
  if (metric === 'roe') {
    // Prefer 加权平均净资产收益率 over 扣除非经常性损益后(的)加权平均净资产收益率.
    const before = page.slice(Math.max(0, position - 36), position);
    if (/扣除非经常性损益/.test(before)) return false;
    if (/扣非后$/.test(before)) return false;
    // Short alias「加权平均净资产收益」must not steal the hit inside「…收益率」.
    if (label === '加权平均净资产收益' && page[position + label.length] === '率') return false;
    // Bare「净资产收益率」must not take 全面摊薄 / 摊薄 row when 加权平均 exists elsewhere.
    const after = page.slice(position + label.length, position + label.length + 16);
    if (/^\s*[（(]?\s*全面摊薄/.test(after)) return false;
    if (/^\s*[（(]?\s*摊薄\s*[)）]/.test(after)) return false;
    return true;
  }
  if (metric === 'eps') {
    // Skip 扣除非经常性损益后的基本和稀释每股收益 — keep the headline EPS row.
    const before = page.slice(Math.max(0, position - 36), position);
    if (/扣除非经常性损益/.test(before)) return false;
    if (/扣非后$/.test(before)) return false;
    return true;
  }
  return true;
}

function metricCandidates(pages: string[], definition: MetricDefinition) {
  const candidates: Candidate[] = [];
  for (let pageIndex = 0; pageIndex < Math.min(pages.length, PARSE_PAGE_LIMIT); pageIndex += 1) {
    const page = normalizePageText(pages[pageIndex]);
    const isSummary = /主要会计数据|主要财务指标|主要财务比率|报告摘要|财务摘要/.test(page);
    const balanceSheet = new Set([
      'total_assets', 'total_liabilities',
      'cash_and_equivalents', 'restricted_cash',
      'short_term_borrowings', 'long_term_borrowings', 'bonds_payable', 'current_portion_debt',
      'goodwill', 'equity_parent',
    ]);
    const statement = balanceSheet.has(definition.metric) ? /合并资产负债表|资产负债表/
      : definition.metric === 'operating_cash_flow' ? /合并现金流量表|现金流量表/
      : definition.metric === 'non_recurring_pnl' || definition.metric === 'profit_ex_non_recurring'
        ? /非经常性损益|主要会计数据|主要财务指标|主要财务比率|报告摘要|财务摘要|合并利润表|利润表/
      : /合并利润表|利润表/;
    const isPrimaryStatement = statement.test(page);
    const hasPageUnit = Boolean(pageCurrencyUnit(page));
    for (const [labelIndex, label] of definition.labels.entries()) {
      for (const position of allLabelPositions(page, label)) {
        if (!isCleanLabelHit(page, position, label, definition.metric)) continue;
        const scopedPage = page.slice(position);
        const parsed = candidateAfterLabel(scopedPage, label, definition, pageCurrencyUnit(page));
        if (!parsed) continue;
        let score = 0.68;
        if (isSummary) score += 0.14;
        // 中行等：摘要页 EPS/ROE 必须压过后文利润表「（一）基本每股收益」。
        if (isSummary && (definition.metric === 'eps' || definition.metric === 'roe')) score += 0.06;
        if (isPrimaryStatement && definition.metric !== 'roe') score += 0.08;
        if (parsed.detectedUnit || hasPageUnit) score += 0.06;
        if (pageIndex < 30) score += 0.03;
        if (labelIndex === 0) score += 0.03;
        candidates.push({
          metric: definition.metric,
          value: parsed.value,
          unit: definition.unit,
          page: pageIndex + 1,
          sourceLabel: label,
          confidence: 0,
          score,
          ...(parsed.priorValue !== undefined ? { priorValue: parsed.priorValue } : {}),
          ...(parsed.yoyPct !== undefined ? { yoyPct: parsed.yoyPct } : {}),
        });
      }
    }
  }
  return candidates;
}

function chooseCandidate(candidates: Candidate[]) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    // Same score: prefer a hit that carried disclosed YoY / prior from the summary table.
    const aYoy = a.yoyPct !== undefined || a.priorValue !== undefined ? 1 : 0;
    const bYoy = b.yoyPct !== undefined || b.priorValue !== undefined ? 1 : 0;
    if (bYoy !== aYoy) return bYoy - aYoy;
    return a.page - b.page;
  });
  const selected = sorted[0];
  const agreeing = candidates.filter((candidate) => {
    const tolerance = Math.max(0.0001, Math.abs(selected.value) * 0.001);
    return Math.abs(candidate.value - selected.value) <= tolerance;
  });
  // Statement rows often repeat the current amount without 上年同期 / 同比增减.
  // Keep disclosed YoY from any agreeing hit so a higher-scoring bare row cannot drop it.
  // If a hit already has yoyPct, do NOT borrow priorValue from another agreeing hit:
  // Maotai Q3 EPS often has one hit with yoyPct=0.77 and another that mis-read 0.77 as prior.
  const withYoy = agreeing.find((candidate) => candidate.yoyPct !== undefined);
  const withPrior = agreeing.find((candidate) => candidate.priorValue !== undefined);
  const yoyPct = withYoy?.yoyPct ?? selected.yoyPct;
  const priorValue = withYoy
    ? withYoy.priorValue
    : (withPrior?.priorValue ?? selected.priorValue);
  const conflicting = candidates.some((candidate) => candidate.value !== selected.value && candidate.score >= selected.score - 0.16);
  const confidence = Math.max(0.55, Math.min(0.96, selected.score + (agreeing.length > 1 ? 0.05 : 0) - (conflicting ? 0.12 : 0)));
  return {
    metric: selected.metric,
    value: selected.value,
    unit: selected.unit,
    page: selected.page,
    sourceLabel: selected.sourceLabel,
    confidence: Number(confidence.toFixed(2)),
    ...(priorValue !== undefined ? { priorValue } : {}),
    ...(yoyPct !== undefined ? { yoyPct } : {}),
  };
}

export function parseCoreMetricPages(pages: string[]) {
  return LABELS.map((definition) => chooseCandidate(metricCandidates(pages, definition))).filter((metric): metric is ParsedMetric => Boolean(metric));
}

export function parseAuditOpinionFromPages(pages: string[]): ParsedAuditOpinion {
  return parseAuditOpinionPages(pages);
}

function splitPdfToTextPages(output: string) {
  const pages = output.split('\f').map((page) => page.trim());
  if (pages.at(-1) === '') pages.pop();
  return pages;
}

async function extractWithPoppler(bytes: ArrayBuffer | null, filePath?: string) {
  try {
    const { execFileSync } = await import('node:child_process');
    const args = ['-layout', '-f', '1', '-l', String(PARSE_PAGE_LIMIT)];
    const output = filePath
      ? execFileSync('pdftotext', [...args, filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      : execFileSync('pdftotext', [...args, '-', '-'], {
        input: Buffer.from(bytes ?? new ArrayBuffer(0)),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    return splitPdfToTextPages(output);
  } catch (error) {
    console.warn('[parser] Poppler fallback unavailable', { message: String(error) });
    return [];
  }
}

function toChunks(pages: string[]) {
  return pages.slice(0, PARSE_PAGE_LIMIT).map((content, index) => ({
    page: index + 1,
    content: content.replace(/\s+/g, ' ').trim().slice(0, 5000),
  })).filter((chunk) => chunk.content.length >= 40);
}

export async function parseCoreMetrics(bytes: ArrayBuffer | null, options?: { filePath?: string }) {
  const filePath = options?.filePath;
  const size = bytes?.byteLength ?? 0;
  const usePdfJs = Boolean(bytes && size > 0 && !shouldExtractTextExternally(size));

  if (!usePdfJs) {
    const pages = await extractWithPoppler(bytes, filePath);
    const metrics = parseCoreMetricPages(pages);
    return {
      totalPages: pages.length,
      metrics,
      chunks: toChunks(pages),
      auditOpinion: pages.length ? parseAuditOpinionPages(pages) : emptyAuditOpinion(),
    };
  }

  const { extractText, getDocumentProxy } = await import('unpdf');
  // PDF.js may transfer/detach its input buffer. Keep an independent copy for
  // the Poppler fallback before handing bytes to PDF.js.
  const fallbackBytes = bytes!.slice(0);
  const pdf = await getDocumentProxy(new Uint8Array(bytes!));
  const extracted = await extractText(pdf, { mergePages: false }).finally(() => pdf.loadingTask.destroy());
  const primaryPages = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  let pages = primaryPages;
  let metrics = parseCoreMetricPages(pages);
  const disclosedCount = (rows: ParsedMetric[]) => rows.filter((row) => row.yoyPct !== undefined || row.priorValue !== undefined).length;
  const CORE_METRIC_TARGET = 8; // headline + original support rows; extra focus metrics are best-effort
  if (metrics.length < CORE_METRIC_TARGET || disclosedCount(metrics) < 2) {
    const fallbackPages = await extractWithPoppler(fallbackBytes, filePath);
    const fallbackMetrics = parseCoreMetricPages(fallbackPages);
    if (
      fallbackMetrics.length > metrics.length
      || disclosedCount(fallbackMetrics) > disclosedCount(metrics)
    ) {
      pages = fallbackPages;
      metrics = fallbackMetrics;
    }
  }
  return {
    totalPages: pages.length,
    metrics,
    chunks: toChunks(pages),
    auditOpinion: pages.length ? parseAuditOpinionPages(pages) : emptyAuditOpinion(),
  };
}
