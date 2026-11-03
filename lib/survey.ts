import { ApiError } from './api';

export const SURVEY_TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;

export const SURVEY_NICKNAMES = [
  // 两字
  '悟空', '熊二', '花生', '青柠', '芝麻', '布丁', '阿狸', '雾雾', '奶茶', '老王',
  // 三字
  '小土豆', '大橘猫', '豆沙包', '咕噜酱', '桃桃乌', '草莓派', '果汁君', '柠檬精',
  '小笼包', '月亮脸', '阿茶酱', '芝麻糊',
  // 四字
  '快乐星球', '干饭冠军', '摸鱼达人', '半糖人生', '人间清醒', '宇宙甜心', '躺平选手', '快乐小狗',
] as const;

export const B1_OPTIONS = ['几乎不看', '自己翻 PDF', '看研报或新闻摘要', '用过其它工具'] as const;
export const B2_OPTIONS = ['费劲', '一般', '轻松'] as const;
export const B3_OPTIONS = ['分不清', '大致懂', '很清楚'] as const;
export const B4_OPTIONS = ['有帮助', '一般', '点了但没懂', '没注意到'] as const;
export const B5_OPTIONS = ['很差', '一般', '不错', '很好'] as const;

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
export type D1 = (typeof D1_OPTIONS)[number];
export type D2 = (typeof D2_OPTIONS)[number];
export type D4 = (typeof D4_OPTIONS)[number];
export type D6 = (typeof D6_OPTIONS)[number];
export type D7 = (typeof D7_OPTIONS)[number];
export type D8 = (typeof D8_OPTIONS)[number];
export type D10 = (typeof D10_OPTIONS)[number];

export type SurveyBasic = {
  b1: B1;
  b2: B2;
  b3: B3;
  b4: B4;
  b5: B5;
  /** Optional free note at end of basic block (shown even when deep is off). */
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
  const basic: SurveyBasic = {
    b1: pickOne(b.b1, 'B1', B1_SET),
    b2: pickOne(b.b2, 'B2', B2_SET),
    b3: pickOne(b.b3, 'B3', B3_SET),
    b4: pickOne(b.b4, 'B4', B4_SET),
    b5: pickOne(b.b5, 'B5', B5_SET),
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
