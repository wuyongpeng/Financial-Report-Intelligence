import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import seedAll from '@/data/industry-skills/_all.json';
import badgesSeed from '@/data/industry-skills/badges.json';
import {
  FALLBACK_ATTRIBUTION_MODULES,
  depthAttributionLead,
  industryAttributionModules as industryAttributionModulesFromSeed,
  resolveIndustrySkillKey as resolveIndustrySkillKeyFromSeed,
  type AttributionModuleDef,
  type IndustrySkillUserFacing,
} from './industry-skills-ui';

export type { AttributionModuleDef, IndustrySkillUserFacing };
export { FALLBACK_ATTRIBUTION_MODULES, depthAttributionLead };

export type IndustrySkill = {
  id: string;
  industry: string;
  sector?: string;
  exampleCompanies?: string[];
  userFacing: IndustrySkillUserFacing;
  systemAppend: string;
  attributionSkeleton?: string[];
  attributionModules?: AttributionModuleDef[];
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

/** Exact, then longest skill contained in the label; reverse match skips broad fragments. */
export function resolveIndustrySkillKey(industry: string | null | undefined): string | null {
  if (!industry || industry === '待分类') return null;
  const trimmed = industry.trim();
  if (!trimmed) return null;
  const skills = loadSkills();
  if (skills.has(trimmed)) return trimmed;
  let best: string | null = null;
  for (const key of skills.keys()) {
    if (trimmed.includes(key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  if (best) return best;
  // Prefer seed resolver (same broad-fragment guard) before reverse contains.
  const fromSeed = resolveIndustrySkillKeyFromSeed(industry);
  if (fromSeed) return fromSeed;
  return null;
}

export function getIndustrySkill(industry: string | null | undefined): IndustrySkill | null {
  const key = resolveIndustrySkillKey(industry);
  if (!key) return null;
  return loadSkills().get(key) ?? null;
}

export function industrySkillSystemAppend(industry: string | null | undefined): string {
  return getIndustrySkill(industry)?.systemAppend?.trim() ?? '';
}

export function industrySkillUserFacing(industry: string | null | undefined): IndustrySkillUserFacing | null {
  if (!industry || industry === '待分类') return null;
  const fromSkill = getIndustrySkill(industry)?.userFacing;
  if (fromSkill?.badge) return fromSkill;
  const badges = badgesSeed as BadgeMap;
  if (badges[industry]) return badges[industry];
  const key = resolveIndustrySkillKey(industry);
  if (key && badges[key]) return badges[key];
  return null;
}

/** Prefer these keywords when building a retrieval question (caller decides how). */
export function industrySkillRetrievalKeywords(industry: string | null | undefined): string[] {
  return getIndustrySkill(industry)?.retrievalKeywords ?? [];
}

/**
 * Industry skill attribution dimensions for 深度归因.
 * null → caller must use FALLBACK_ATTRIBUTION_MODULES.
 */
export function industryAttributionModules(industry: string | null | undefined): AttributionModuleDef[] | null {
  const fromDisk = getIndustrySkill(industry)?.attributionModules;
  if (fromDisk?.length) return fromDisk;
  return industryAttributionModulesFromSeed(industry);
}

/** Parse「行业 X」from structuredContext lines produced by retrieve-context. */
export function industryFromStructuredContext(structuredContext: string | null | undefined): string | null {
  if (!structuredContext) return null;
  const match = structuredContext.match(/行业\s*([^\s，。；\n]+)/);
  const value = match?.[1]?.trim();
  if (!value || value === '待分类') return null;
  return value;
}
