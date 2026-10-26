import seedAll from '@/data/industry-skills/_all.json';
import badgesSeed from '@/data/industry-skills/badges.json';

export type IndustrySkillUserFacing = {
  badge: string;
  hover: string;
};

export type AttributionModuleDef = {
  id: string;
  title: string;
  hint: string;
  /** Lower number = higher priority. Primary industry dims use 1–5; shared secondary uses 10+. */
  priority?: number;
};

type SkillLite = {
  industry: string;
  userFacing?: IndustrySkillUserFacing;
  attributionModules?: AttributionModuleDef[];
};

type BadgeMap = Record<string, IndustrySkillUserFacing>;

/** Fixed five modules used when the company has no industry skill dimensions. */
export const FALLBACK_ATTRIBUTION_MODULES: AttributionModuleDef[] = [
  {
    id: 'business',
    title: '主营业务',
    hint: '解释主营/分部收入结构为何变化；仅当原文明确给出业务/产品/地区收入结构或结构变化并带数字。',
  },
  {
    id: 'attribution',
    title: '净利润变动',
    hint: '解释净利润为何变动；仅当原文写了净利润变动的构成或原因并带数字；结构化同比已在上下文中，不要复述指标卡。',
  },
  {
    id: 'anomalies',
    title: '异常指标提示',
    hint: '解释异常/大幅波动指标为何出现；仅当原文点名异常并带数字。',
  },
  {
    id: 'history',
    title: '历史趋势详情',
    hint: '仅当原文给出跨年/跨期趋势数字，且不是简单重复结构化同比。',
  },
  {
    id: 'peers',
    title: '同业对比',
    hint: '仅当原文给出市场份额或行业地位数字。页面若已有同业样本排名会优先用计算值。',
  },
];

/**
 * Shared lower-priority attribution angles (~10).
 * Appended after each industry's primary 5 so the pool is ~15.
 * Used when primary dims lack disclosure.
 */
export const SECONDARY_ATTRIBUTION_MODULES: AttributionModuleDef[] = [
  {
    id: 'revenue_profit',
    title: '营收与净利',
    hint: '营业收入与归母净利润的同比变化及量利是否同向；须有数字。',
    priority: 10,
  },
  {
    id: 'gross_opex',
    title: '毛利与费用率',
    hint: '毛利率及销售/管理/研发费用率变动；有原文或结构化比率才写。',
    priority: 11,
  },
  {
    id: 'rd_intensity',
    title: '研发投入',
    hint: '研发费用、研发费用率或研发投入披露；进展叙述≠已确认收入。',
    priority: 12,
  },
  {
    id: 'overseas',
    title: '海外与出口',
    hint: '海外/出口收入、占比或区域拆分；无原文不写。',
    priority: 13,
  },
  {
    id: 'cash_conversion',
    title: '经营现金流',
    hint: '经营现金流净额及其与净利润的匹配；须有数字。',
    priority: 14,
  },
  {
    id: 'inventory_quality',
    title: '存货与减值',
    hint: '存货余额、跌价准备或资产减值；有披露才写。',
    priority: 15,
  },
  {
    id: 'capacity_capex',
    title: '产能与资本开支',
    hint: '购建固定资产、资本开支、产能/扩产相关披露。',
    priority: 16,
  },
  {
    id: 'channel_contract',
    title: '渠道与合同负债',
    hint: '合同负债、预收款、经销商或渠道库存线索；有原文才写。',
    priority: 17,
  },
  {
    id: 'tax_oneoff',
    title: '税费与一次性损益',
    hint: '所得税、政府补助、投资收益、营业外或非经常性损益等一次性因素。',
    priority: 18,
  },
  {
    id: 'guidance_outlook',
    title: '展望与指引',
    hint: '管理层对下期销量/收入/资本开支等的明确指引或展望；仅限原文。',
    priority: 19,
  },
];

const PRIMARY_PRIORITY_MAX = 5;
const DEFAULT_DISPLAY_SLOTS = 5;

/** Primary industry dims (or fallback five) plus shared secondary pool ≈ 15 angles. */
export function expandAttributionModulePool(
  primary: AttributionModuleDef[] | null | undefined,
): AttributionModuleDef[] {
  const base = primary?.length ? primary : FALLBACK_ATTRIBUTION_MODULES;
  const withPri = base.map((m, i) => ({
    ...m,
    priority: m.priority ?? i + 1,
  }));
  const seenIds = new Set(withPri.map((m) => m.id));
  const seenTitles = new Set(withPri.map((m) => m.title));
  const secondary = SECONDARY_ATTRIBUTION_MODULES.filter(
    (m) => !seenIds.has(m.id) && !seenTitles.has(m.title),
  );
  return [...withPri, ...secondary];
}

/** True when a conclusion is missing, number-less, or a pure empty/limited stub. */
export function isEmptyAttributionConclusion(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (!/\d/.test(t)) return true;
  if (/^(本期该维度披露有限|暂无|未披露|无)$/u.test(t)) return true;
  return false;
}

/**
 * Prefer substantive primary conclusions; if all primary are empty/limited,
 * fall back to filled secondary angles. Cap at ~5 display slots.
 * Never return 15 empty rows — if nothing is filled, return top primary for empty UI.
 */
export function selectDisplayAttributionModules(
  pool: AttributionModuleDef[],
  modules: Array<{ id: string; conclusion?: string | null }>,
  opts?: { maxDisplay?: number },
): AttributionModuleDef[] {
  const maxDisplay = opts?.maxDisplay ?? DEFAULT_DISPLAY_SLOTS;
  if (!pool.length) return [];
  const byId = new Map(modules.map((m) => [m.id, m]));
  const sorted = [...pool].sort(
    (a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.id.localeCompare(b.id),
  );
  const primary = sorted.filter((m) => (m.priority ?? 99) <= PRIMARY_PRIORITY_MAX);
  const secondary = sorted.filter((m) => (m.priority ?? 99) > PRIMARY_PRIORITY_MAX);

  const isFilled = (def: AttributionModuleDef) => {
    const row = byId.get(def.id);
    return Boolean(row && !isEmptyAttributionConclusion(row.conclusion));
  };

  // Weak = pure neighbor-fallback stubs ("未单独披露…改用邻近"). Keyword-hit synthesis counts.
  const isSubstantive = (def: AttributionModuleDef) => {
    const row = byId.get(def.id);
    if (!row || isEmptyAttributionConclusion(row.conclusion)) return false;
    const c = (row.conclusion || '').trim();
    if (/^未单独披露/.test(c) && /改用邻近/.test(c)) return false;
    return true;
  };

  const substantivePrimary = primary.filter(isSubstantive);
  const filledPrimary = primary.filter(isFilled);
  const substantiveSecondary = secondary.filter(isSubstantive);
  const filledSecondary = secondary.filter(isFilled);

  let picked: AttributionModuleDef[];
  if (substantivePrimary.length > 0) {
    picked = [...substantivePrimary, ...substantiveSecondary, ...filledSecondary].filter(
      (def, idx, arr) => arr.findIndex((x) => x.id === def.id) === idx,
    );
  } else if (substantiveSecondary.length > 0) {
    // All primary empty/weak → surface whatever secondary can attribute.
    picked = substantiveSecondary;
  } else if (filledPrimary.length > 0) {
    picked = [...filledPrimary, ...filledSecondary].filter(
      (def, idx, arr) => arr.findIndex((x) => x.id === def.id) === idx,
    );
  } else if (filledSecondary.length > 0) {
    picked = filledSecondary;
  } else {
    // Nothing usable — keep top primary slots so UI can show 披露有限 (not 15 empties).
    picked = primary.length ? primary : sorted.slice(0, maxDisplay);
  }

  return picked.slice(0, maxDisplay);
}

const skillByIndustry = new Map<string, SkillLite>();
for (const item of seedAll as SkillLite[]) {
  if (item?.industry) skillByIndustry.set(item.industry, item);
}

/**
 * Exact match, then longest skill name contained in the label
 * (e.g. 半导体及元件 → 半导体). Reverse match (skill contains label)
 * is only for non-broad labels so 「电子」 does not become 「消费电子」.
 */
const BROAD_INDUSTRY_FRAGMENTS = new Set([
  '电子', '计算机', '通信', '汽车', '机械', '建筑', '电力', '金融', '医药', '生物', '化工', '材料',
]);

export function resolveIndustrySkillKey(industry: string | null | undefined): string | null {
  if (!industry || industry === '待分类') return null;
  const trimmed = industry.trim();
  if (!trimmed) return null;
  if (skillByIndustry.has(trimmed)) return trimmed;
  let best: string | null = null;
  for (const key of skillByIndustry.keys()) {
    if (trimmed.includes(key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  if (best) return best;
  if (BROAD_INDUSTRY_FRAGMENTS.has(trimmed) || trimmed.length < 3) return null;
  for (const key of skillByIndustry.keys()) {
    if (key.includes(trimmed)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best;
}

function skillLite(industry: string | null | undefined): SkillLite | null {
  const key = resolveIndustrySkillKey(industry);
  return key ? skillByIndustry.get(key) ?? null : null;
}

/** Client-safe badge/hover lookup (no Node fs). Fuzzy-resolves industry labels. */
export function industrySkillUserFacing(industry: string | null | undefined): IndustrySkillUserFacing | null {
  if (!industry || industry === '待分类') return null;
  const fromSkill = skillLite(industry)?.userFacing;
  if (fromSkill?.badge) return fromSkill;
  const badges = badgesSeed as BadgeMap;
  if (badges[industry]) return badges[industry];
  const key = resolveIndustrySkillKey(industry);
  if (key && badges[key]) return badges[key];
  return null;
}

/**
 * Industry skill attribution dimensions for 深度归因.
 * Returns null when the company should use FALLBACK_ATTRIBUTION_MODULES.
 */
export function industryAttributionModules(industry: string | null | undefined): AttributionModuleDef[] | null {
  const mods = skillLite(industry)?.attributionModules;
  if (!mods?.length) return null;
  return mods;
}

export function depthAttributionLead(industry: string | null | undefined): string {
  // Prefer resolved skill industry name so UI badge「产业视角」 never becomes「按产业行业…」.
  const key = resolveIndustrySkillKey(industry);
  if (key) return `按${key}行业视角组织归因`;
  const ui = industrySkillUserFacing(industry);
  if (ui?.badge) {
    const name = ui.badge.replace(/视角$/, '');
    if (name && name !== '产业') return `按${name}行业视角组织归因`;
  }
  return '解释营收、利润与异常指标为何变动';
}
