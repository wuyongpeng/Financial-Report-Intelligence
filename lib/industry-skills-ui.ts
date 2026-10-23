import badgesSeed from '@/data/industry-skills/badges.json';

export type IndustrySkillUserFacing = {
  badge: string;
  hover: string;
};

type BadgeMap = Record<string, IndustrySkillUserFacing>;

/** Client-safe badge/hover lookup (no Node fs). */
export function industrySkillUserFacing(industry: string | null | undefined): IndustrySkillUserFacing | null {
  if (!industry || industry === '待分类') return null;
  const badges = badgesSeed as BadgeMap;
  return badges[industry] ?? null;
}
