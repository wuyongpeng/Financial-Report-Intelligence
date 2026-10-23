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

const skillByIndustry = new Map<string, SkillLite>();
for (const item of seedAll as SkillLite[]) {
  if (item?.industry) skillByIndustry.set(item.industry, item);
}

/** Exact match, then longest skill name contained in / containing the label. */
export function resolveIndustrySkillKey(industry: string | null | undefined): string | null {
  if (!industry || industry === '待分类') return null;
  const trimmed = industry.trim();
  if (!trimmed) return null;
  if (skillByIndustry.has(trimmed)) return trimmed;
  let best: string | null = null;
  for (const key of skillByIndustry.keys()) {
    if (trimmed.includes(key) || key.includes(trimmed)) {
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
  const ui = industrySkillUserFacing(industry);
  if (ui?.badge) {
    const name = ui.badge.replace(/视角$/, '');
    return `按${name}行业视角组织归因`;
  }
  const key = resolveIndustrySkillKey(industry);
  if (key) return `按${key}行业视角组织归因`;
  return '解释营收、利润与异常指标为何变动';
}
