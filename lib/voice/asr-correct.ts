/**
 * ASR homophone correction: rewrite clear misrecognitions using company/industry
 * hotwords BEFORE text goes to Q&A / search. Pinyin match (tone-less), longer terms first.
 */
import { pinyin } from 'pinyin-pro';

export type AsrCorrectContext = {
  /** Current detail company name, e.g. 紫金矿业 */
  companyName?: string | null;
  /** Stock code */
  companyCode?: string | null;
  /** Industry label, e.g. 有色 / 锂电 */
  industry?: string | null;
  /** Extra lexicon terms (roster names, retrieval keywords, …) */
  extraTerms?: string[] | null;
};

export type AsrReplacement = { from: string; to: string; index: number };

export type AsrCorrectResult = {
  text: string;
  replacements: AsrReplacement[];
};

/** Always-on finance lexicon (unambiguous report terms). */
export const GLOBAL_ASR_HOTWORDS: readonly string[] = [
  '归母净利润',
  '扣非净利润',
  '归母净利',
  '营业收入',
  '营业成本',
  '毛利率',
  '净利率',
  '经营现金流',
  '自由现金流',
  '资本开支',
  '净资产收益率',
  '基本每股收益',
  '稀释每股收益',
  '资产负债率',
  '存货周转',
  '应收账款',
  '合同负债',
  '非经常性损益',
  '同比',
  '环比',
  '豆粕',
  '生猪',
  '吨价',
  '出货量',
  '装机量',
];

/** Lithium / nonferrous terms — only when context looks like 紫金/锂电/有色. */
export const LITHIUM_ASR_HOTWORDS: readonly string[] = [
  '锂盐',
  '碳酸锂',
  '氢氧化锂',
  '锂精矿',
  '锂辉石',
  '电解铜',
  '阴极铜',
  '矿产金',
  '冶炼',
  '选矿',
];

/** Explicit ASR confusions that are not exact tone-less pinyin matches. */
const EXPLICIT_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['豆泊', '豆粕'],
  ['豆波', '豆粕'],
  ['归母静利', '归母净利'],  // shorter forms handled via lexicon windows too
];

const LITHIUM_CONTEXT_RE =
  /锂|有色|电池|新能源|紫金|赣锋|天齐|盛新|雅化|永兴|中矿|盐湖|宁德|亿纬|国轩|科达|华友|盛屯|洛阳钼|江西铜|铜陵非|藏格|永杉|川能|融捷/;

function pyKey(s: string): string {
  if (!s) return '';
  const parts = pinyin(s, { toneType: 'none', type: 'array' }) as string[];
  return parts.join('').toLowerCase().replace(/\s+/g, '');
}

function uniqTerms(terms: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const t = (raw ?? '').trim();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  // Longer first so 「归母净利润」 beats 「归母」
  out.sort((a, b) => b.length - a.length || a.localeCompare(b, 'zh'));
  return out;
}

export function lithiumContextActive(ctx: AsrCorrectContext = {}): boolean {
  const blob = [ctx.companyName, ctx.companyCode, ctx.industry, ...(ctx.extraTerms ?? [])]
    .filter(Boolean)
    .join('|');
  return LITHIUM_CONTEXT_RE.test(blob);
}

/** Build active lexicon for this page/context. */
export function buildAsrLexicon(ctx: AsrCorrectContext = {}): string[] {
  const bag: string[] = [...GLOBAL_ASR_HOTWORDS];
  if (ctx.companyName) bag.push(ctx.companyName);
  if (lithiumContextActive(ctx)) bag.push(...LITHIUM_ASR_HOTWORDS);
  if (ctx.extraTerms) bag.push(...ctx.extraTerms);
  return uniqTerms(bag);
}

/**
 * Rewrite ASR text: any window whose tone-less pinyin matches a lexicon term
 * but characters differ → replace with the lexicon term.
 */
export function correctAsrText(
  raw: string,
  ctx: AsrCorrectContext = {},
): AsrCorrectResult {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { text: '', replacements: [] };

  const lexicon = buildAsrLexicon(ctx);
  if (!lexicon.length) return { text, replacements: [] };

  const chars = [...text];
  const replacements: AsrReplacement[] = [];
  // Track which char indices are already locked by a prior (longer) replacement.
  const locked = new Array(chars.length).fill(false);

  for (const term of lexicon) {
    const n = [...term].length;
    if (n < 2) continue;
    const targetPy = pyKey(term);
    if (!targetPy) continue;

    for (let i = 0; i <= chars.length - n; i++) {
      let blocked = false;
      for (let k = 0; k < n; k++) {
        if (locked[i + k]) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const slice = chars.slice(i, i + n).join('');
      if (slice === term) {
        for (let k = 0; k < n; k++) locked[i + k] = true;
        continue;
      }
      // Only rewrite Han / mixed windows that look like speech errors.
      if (!/[\u4e00-\u9fff]/.test(slice)) continue;
      if (pyKey(slice) !== targetPy) continue;

      const termChars = [...term];
      for (let k = 0; k < n; k++) {
        chars[i + k] = termChars[k]!;
        locked[i + k] = true;
      }
      replacements.push({ from: slice, to: term, index: i });
    }
  }

  let out = chars.join('');
  const lexSet = new Set(lexicon);
  for (const [from, to] of EXPLICIT_ALIASES) {
    if (!lexSet.has(to)) continue;
    if (!out.includes(from)) continue;
    let start = 0;
    while (true) {
      const idx = out.indexOf(from, start);
      if (idx < 0) break;
      out = out.slice(0, idx) + to + out.slice(idx + from.length);
      replacements.push({ from, to, index: idx });
      start = idx + to.length;
    }
  }

  return { text: out, replacements };
}

/** Convenience: corrected string only. */
export function correctAsrHomophones(raw: string, ctx: AsrCorrectContext = {}): string {
  return correctAsrText(raw, ctx).text;
}
