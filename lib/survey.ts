import { ApiError } from './api';

export const SURVEY_TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;

export const SURVEY_NICKNAMES = [
  '张三', '悟空', '熊二', '花生酱', '青柠', '芝麻', '布丁', '阿狸', '小林', '小鱼',
  '老王', '番茄', '可乐', '小土豆', '大橘猫', '桃桃乌', '柠檬精', '芝麻糊', '摸鱼达人',
] as const;

/** Q1 平时怎么接触财报（多选） */
export const B1_OPTIONS = ['几乎不看', '自己翻 PDF', '看研报或新闻摘要', '用过其它工具'] as const;
/** Q2 打开到看到财报的过程 */
export const B2_OPTIONS = ['很顺', '一般', '费劲', '没找到想看的公司'] as const;
/** Q3 左中右三栏布局 */
export const B3_OPTIONS = ['分不清', '大致懂', '很清楚'] as const;
/** Q4 体验后对财报是否更清楚 */
export const B4_OPTIONS = ['清楚很多', '有一些', '没变化', '更糊涂了'] as const;
/** Q5 追问栏里的Eva回答内容的角标 */
export const B5_OPTIONS = [
  '点过,有帮助',
  '点过,一般',
  '点过,但没看懂跳到了哪里',
  '看到了,但没点',
  '没注意到有角标',
] as const;
/** Q6 是否用过类似产品 */
export const B6_CHOICES = ['没有', '用过'] as const;

export const D1_OPTIONS = ['三栏结论', '角标核对', '语音/追问', '检索找公司', '关键数字展示'] as const;
export const D2_OPTIONS = ['找不到公司', '看不懂结论', '不信数字', '不知问啥', '页面不知道点哪', '其它'] as const;
export const D4_OPTIONS = [
  '更多公司', '数据更准', '教会我怎么问', '手机更好用', '能分享给同事', '少些 AI 腔', '其它短填',
] as const;
export const D6_OPTIONS = ['太密', '刚好', '太空', '看情景'] as const;
export const D7_OPTIONS = ['不到1分钟', '1–3分钟', '更久', '没找到'] as const;
export const D8_OPTIONS = ['对照原文', '行业对比', '历史趋势', '风险提示', '导出分享', '其它'] as const;
export const D10_OPTIONS = ['季报速读', '同行对比', '追问数字', '给同事讲清楚', '其它'] as const;

export type B1 = (typeof B1_OPTIONS)[number];
export type B2 = (typeof B2_OPTIONS)[number];
export type B3 = (typeof B3_OPTIONS)[number];
export type B4 = (typeof B4_OPTIONS)[number];
export type B5 = (typeof B5_OPTIONS)[number];
export type B6Choice = (typeof B6_CHOICES)[number];
export type D1 = (typeof D1_OPTIONS)[number];
export type D2 = (typeof D2_OPTIONS)[number];
export type D4 = (typeof D4_OPTIONS)[number];
export type D6 = (typeof D6_OPTIONS)[number];
export type D7 = (typeof D7_OPTIONS)[number];
export type D8 = (typeof D8_OPTIONS)[number];
export type D10 = (typeof D10_OPTIONS)[number];

export type SurveyBasic = {
  /** Q1 多选 */
  b1: B1[];
  b2: B2;
  b3: B3;
  b4: B4;
  b5: B5;
  /** Q6 类似产品 */
  b6: { choice: B6Choice; product?: string };
  /** Q7 选填 */
  note?: string;
};

export type SurveyDeep = {
  d1?: D1[];
  d2?: { choice: D2; note?: string };
  d3?: number;
  d4?: { choices: D4[]; other?: string };
  d5?: string;
  d6?: D6;
  d7?: D7;
  d8?: D8[];
  d9?: number;
  d10?: { choice: D10; note?: string };
};

export type SurveySubmission = {
  nickname: string | null;
  basic: SurveyBasic;
  deep: SurveyDeep | null;
};

const B1_SET = new Set<string>(B1_OPTIONS);
const B2_SET = new Set<string>(B2_OPTIONS);
const B3_SET = new Set<string>(B3_OPTIONS);
const B4_SET = new Set<string>(B4_OPTIONS);
const B5_SET = new Set<string>(B5_OPTIONS);
const B6_SET = new Set<string>(B6_CHOICES);
const D1_SET = new Set<string>(D1_OPTIONS);
const D2_SET = new Set<string>(D2_OPTIONS);
const D4_SET = new Set<string>(D4_OPTIONS);
const D6_SET = new Set<string>(D6_OPTIONS);
const D7_SET = new Set<string>(D7_OPTIONS);
const D8_SET = new Set<string>(D8_OPTIONS);
const D10_SET = new Set<string>(D10_OPTIONS);

export function isValidSurveyToken(token: string) {
  return SURVEY_TOKEN_RE.test(token);
}

function pickOne<T extends string>(value: unknown, name: string, allowed: Set<string>): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new ApiError(400, `${name} 无效`);
  }
  return value as T;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new ApiError(400, '文本格式无效');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new ApiError(400, `文本最多 ${max} 字`);
  return trimmed;
}

/** Validate public survey payload before touching the database. */
export function parseSurveySubmission(body: Record<string, unknown>): SurveySubmission {
  let nickname: string | null = null;
  if (typeof body.nickname === 'string') {
    const trimmed = body.nickname.trim();
    if (trimmed) {
      if (trimmed.length > 32) throw new ApiError(400, '昵称最多 32 字');
      nickname = trimmed;
    }
  }

  const basicRaw = body.basic;
  if (!basicRaw || typeof basicRaw !== 'object' || Array.isArray(basicRaw)) {
    throw new ApiError(400, '请完成基础问题');
  }
  const b = basicRaw as Record<string, unknown>;

  if (!Array.isArray(b.b1) || b.b1.length < 1) {
    throw new ApiError(400, 'B1 请至少选一项');
  }
  if (b.b1.length > B1_OPTIONS.length) throw new ApiError(400, 'B1 选项过多');
  const b1: B1[] = [];
  for (const item of b.b1) {
    if (typeof item !== 'string' || !B1_SET.has(item)) throw new ApiError(400, 'B1 选项无效');
    if (b1.includes(item as B1)) throw new ApiError(400, 'B1 不可重复');
    b1.push(item as B1);
  }

  if (b.b6 == null || typeof b.b6 !== 'object' || Array.isArray(b.b6)) {
    throw new ApiError(400, 'B6 无效');
  }
  const b6raw = b.b6 as Record<string, unknown>;
  const b6Choice = pickOne<B6Choice>(b6raw.choice, 'B6', B6_SET);
  const product = optionalText(b6raw.product, 80);
  const b6: SurveyBasic['b6'] = b6Choice === '用过' && product
    ? { choice: b6Choice, product }
    : { choice: b6Choice };

  const basic: SurveyBasic = {
    b1,
    b2: pickOne(b.b2, 'B2', B2_SET),
    b3: pickOne(b.b3, 'B3', B3_SET),
    b4: pickOne(b.b4, 'B4', B4_SET),
    b5: pickOne(b.b5, 'B5', B5_SET),
    b6,
  };
  const basicNote = optionalText(b.note, 200);
  if (basicNote) basic.note = basicNote;

  const deepEnabled = Boolean(body.deepEnabled);
  if (!deepEnabled) {
    return { nickname, basic, deep: null };
  }

  const deepRaw = body.deep;
  if (deepRaw == null) {
    return { nickname, basic, deep: {} };
  }
  if (typeof deepRaw !== 'object' || Array.isArray(deepRaw)) {
    throw new ApiError(400, '深入反馈格式无效');
  }
  const d = deepRaw as Record<string, unknown>;
  const deep: SurveyDeep = {};

  if (d.d1 != null) {
    if (!Array.isArray(d.d1)) throw new ApiError(400, 'D1 格式无效');
    if (d.d1.length > 3) throw new ApiError(400, 'D1 最多排前三');
    const ranked: D1[] = [];
    for (const item of d.d1) {
      if (typeof item !== 'string' || !D1_SET.has(item)) throw new ApiError(400, 'D1 选项无效');
      if (ranked.includes(item as D1)) throw new ApiError(400, 'D1 不可重复');
      ranked.push(item as D1);
    }
    if (ranked.length) deep.d1 = ranked;
  }

  if (d.d2 != null) {
    if (typeof d.d2 !== 'object' || Array.isArray(d.d2)) throw new ApiError(400, 'D2 格式无效');
    const d2 = d.d2 as Record<string, unknown>;
    const choice = pickOne<D2>(d2.choice, 'D2', D2_SET);
    const note = optionalText(d2.note, 200);
    deep.d2 = note ? { choice, note } : { choice };
  }

  if (d.d3 != null) {
    const n = typeof d.d3 === 'number' ? d.d3 : Number(d.d3);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ApiError(400, 'D3 须为 1–5');
    deep.d3 = n;
  }

  if (d.d4 != null) {
    if (typeof d.d4 !== 'object' || Array.isArray(d.d4)) throw new ApiError(400, 'D4 格式无效');
    const d4 = d.d4 as Record<string, unknown>;
    if (!Array.isArray(d4.choices)) throw new ApiError(400, 'D4 格式无效');
    if (d4.choices.length > 3) throw new ApiError(400, 'D4 最多选 3 项');
    const choices: D4[] = [];
    for (const item of d4.choices) {
      if (typeof item !== 'string' || !D4_SET.has(item)) throw new ApiError(400, 'D4 选项无效');
      if (choices.includes(item as D4)) throw new ApiError(400, 'D4 不可重复');
      choices.push(item as D4);
    }
    const other = optionalText(d4.other, 200);
    if (choices.length || other) {
      deep.d4 = other ? { choices, other } : { choices };
    }
  }

  const d5 = optionalText(d.d5, 500);
  if (d5) deep.d5 = d5;

  if (d.d6 != null) {
    deep.d6 = pickOne<D6>(d.d6, 'D6', D6_SET);
  }

  if (d.d7 != null) {
    deep.d7 = pickOne<D7>(d.d7, 'D7', D7_SET);
  }

  if (d.d8 != null) {
    if (!Array.isArray(d.d8)) throw new ApiError(400, 'D8 格式无效');
    if (d.d8.length > 3) throw new ApiError(400, 'D8 最多选 3 项');
    const choices: D8[] = [];
    for (const item of d.d8) {
      if (typeof item !== 'string' || !D8_SET.has(item)) throw new ApiError(400, 'D8 选项无效');
      if (choices.includes(item as D8)) throw new ApiError(400, 'D8 不可重复');
      choices.push(item as D8);
    }
    if (choices.length) deep.d8 = choices;
  }

  if (d.d9 != null) {
    const n = typeof d.d9 === 'number' ? d.d9 : Number(d.d9);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new ApiError(400, 'D9 须为 1–5');
    deep.d9 = n;
  }

  if (d.d10 != null) {
    if (typeof d.d10 !== 'object' || Array.isArray(d.d10)) throw new ApiError(400, 'D10 格式无效');
    const d10 = d.d10 as Record<string, unknown>;
    const choice = pickOne<D10>(d10.choice, 'D10', D10_SET);
    const note = optionalText(d10.note, 200);
    deep.d10 = note ? { choice, note } : { choice };
  }

  return { nickname, basic, deep };
}

export function randomSurveyNickname(seed = Math.random()) {
  const idx = Math.floor(seed * SURVEY_NICKNAMES.length) % SURVEY_NICKNAMES.length;
  return SURVEY_NICKNAMES[idx]!;
}

export function countMap(values: Array<string | null | undefined>) {
  const map: Record<string, number> = {};
  for (const v of values) {
    if (!v) continue;
    map[v] = (map[v] ?? 0) + 1;
  }
  return map;
}

/** Admin / UI helper: structured basic summary (compat old string b1). */
export function formatSurveyBasicLine(basic: Record<string, unknown> | null | undefined): string {
  if (!basic || typeof basic !== 'object') return '';
  const bits: string[] = [];

  const b1 = basic.b1;
  let contact = '';
  if (Array.isArray(b1) && b1.length) {
    contact = b1.filter((x): x is string => typeof x === 'string' && !!x).join('、');
  } else if (typeof b1 === 'string' && b1) {
    contact = b1;
  }
  if (contact) bits.push(`接触：${contact}`);

  if (typeof basic.b2 === 'string' && basic.b2) bits.push(`体验感：${basic.b2}`);
  if (typeof basic.b3 === 'string' && basic.b3) bits.push(`三栏：${basic.b3}`);
  if (typeof basic.b5 === 'string' && basic.b5) bits.push(`角标：${basic.b5}`);
  if (typeof basic.b4 === 'string' && basic.b4) bits.push(`印象：${basic.b4}`);

  const b6 = basic.b6;
  if (b6 && typeof b6 === 'object' && !Array.isArray(b6)) {
    const choice = (b6 as Record<string, unknown>).choice;
    const product = (b6 as Record<string, unknown>).product;
    if (choice === '用过') {
      const name = typeof product === 'string' && product.trim() ? product.trim() : '';
      bits.push(name ? `类似：用过·${name}` : '类似：用过');
    } else if (typeof choice === 'string' && choice) {
      bits.push(`类似：${choice}`);
    }
  }

  if (typeof basic.note === 'string' && basic.note.trim()) {
    bits.push(`想法：${basic.note.trim()}`);
  }
  return bits.join('; ');
}

/** Admin / UI helper: structured deep summary with readable prefixes. */
export function formatSurveyDeepLine(deep: SurveyDeep | Record<string, unknown> | null | undefined): string {
  if (!deep || typeof deep !== 'object') return '';
  const d = deep as SurveyDeep;
  const bits: string[] = [];
  if (d.d1?.length) bits.push(`价值：${d.d1.join('>')}`);
  if (d.d2?.choice) {
    bits.push(`卡住：${d.d2.choice}${d.d2.note ? `（${d.d2.note}）` : ''}`);
  }
  if (typeof d.d3 === 'number') bits.push(`信任：${d.d3}`);
  if (d.d4 && (d.d4.choices?.length || d.d4.other)) {
    const body = [
      ...(d.d4.choices?.length ? [d.d4.choices.join('/')] : []),
      ...(d.d4.other ? [`其它:${d.d4.other}`] : []),
    ].join('·');
    bits.push(`再来：${body}`);
  }
  if (d.d5) bits.push(`一句话：${d.d5}`);
  if (d.d6) bits.push(`密度：${d.d6}`);
  if (d.d7) bits.push(`耗时：${d.d7}`);
  if (d.d8?.length) bits.push(`加强：${d.d8.join('/')}`);
  if (typeof d.d9 === 'number') bits.push(`推荐：${d.d9}`);
  if (d.d10?.choice) {
    bits.push(`场景：${d.d10.choice}${d.d10.note ? `（${d.d10.note}）` : ''}`);
  }
  return bits.join('; ');
}
