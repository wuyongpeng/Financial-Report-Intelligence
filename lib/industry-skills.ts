import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import seedAll from '@/data/industry-skills/_all.json';
import badgesSeed from '@/data/industry-skills/badges.json';

export type IndustrySkillUserFacing = {
  badge: string;
  hover: string;
};

export type IndustrySkill = {
  id: string;
  industry: string;
  sector?: string;
  exampleCompanies?: string[];
  userFacing: IndustrySkillUserFacing;
  systemAppend: string;
  attributionSkeleton?: string[];
  retrievalKeywords?: string[];
  moduleHints?: Record<string, string>;
  forbidden?: string[];
  notes?: string;
};

type BadgeMap = Record<string, IndustrySkillUserFacing>;

let skillCache: Map<string, IndustrySkill> | null = null;

function candidateDirs(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, 'data', 'industry-skills'),
    // Next standalone sometimes runs with cwd at .next/standalone
    join(cwd, '..', '..', 'data', 'industry-skills'),
    join(cwd, '..', 'data', 'industry-skills'),
  ];
}

function readSkillsFromDisk(): Map<string, IndustrySkill> | null {
  for (const dir of candidateDirs()) {
    try {
      if (!existsSync(dir)) continue;
      const map = new Map<string, IndustrySkill>();
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json') || name === '_all.json' || name === 'badges.json') continue;
        const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as IndustrySkill;
        if (raw?.industry && raw.systemAppend) map.set(raw.industry, raw);
      }
      if (map.size > 0) return map;
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadSkills(): Map<string, IndustrySkill> {
  if (skillCache) return skillCache;
  const fromDisk = readSkillsFromDisk();
  if (fromDisk) {
    skillCache = fromDisk;
    return skillCache;
  }
  const map = new Map<string, IndustrySkill>();
  for (const item of seedAll as IndustrySkill[]) {
    if (item?.industry) map.set(item.industry, item);
  }
  skillCache = map;
  return skillCache;
}

/** Reset cache — for tests. */
export function resetIndustrySkillCache() {
  skillCache = null;
}

export function getIndustrySkill(industry: string | null | undefined): IndustrySkill | null {
  if (!industry || industry === '待分类') return null;
  return loadSkills().get(industry) ?? null;
}

export function industrySkillSystemAppend(industry: string | null | undefined): string {
  return getIndustrySkill(industry)?.systemAppend?.trim() ?? '';
}

export function industrySkillUserFacing(industry: string | null | undefined): IndustrySkillUserFacing | null {
  if (!industry || industry === '待分类') return null;
  const fromSkill = getIndustrySkill(industry)?.userFacing;
  if (fromSkill?.badge) return fromSkill;
  const badges = badgesSeed as BadgeMap;
  return badges[industry] ?? null;
}

/** Prefer these keywords when building a retrieval question (caller decides how). */
export function industrySkillRetrievalKeywords(industry: string | null | undefined): string[] {
  return getIndustrySkill(industry)?.retrievalKeywords ?? [];
}

/** Parse「行业 X」from structuredContext lines produced by retrieve-context. */
export function industryFromStructuredContext(structuredContext: string | null | undefined): string | null {
  if (!structuredContext) return null;
  const match = structuredContext.match(/行业\s*([^\s，。；\n]+)/);
  const value = match?.[1]?.trim();
  if (!value || value === '待分类') return null;
  return value;
}
