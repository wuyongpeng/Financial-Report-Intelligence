/**
 * Home voice resolve helpers: confirm fuzzy single hits, pick among multi-hits,
 * and parse spoken yes/no or ordinal/name choices. Pure — no React / mic.
 */
import {
  nameVariants,
  officialNameForToken,
  officialNameFromAlias,
} from '@/lib/company-aliases';
import { stripQueryNoise, type ListedNameCode } from '@/lib/home-search';

export type ListedMatchKind = 'code' | 'exact-name' | 'alias' | 'variant' | 'fuzzy' | 'none';

export type VoiceConfirmReply = 'yes' | 'no' | null;

export type VoicePickResult =
  | { kind: 'pick'; index: number }
  | { kind: 'cancel' }
  | null;

/** How tightly `query` identifies `listed` (ignores surrounding ask words). */
export function listedMatchKind(query: string, listed: ListedNameCode): ListedMatchKind {
  const raw = query.trim();
  if (!raw || !listed?.code) return 'none';

  if (listed.code && (raw === listed.code || new RegExp(`(?<!\\d)${listed.code}(?!\\d)`).test(raw))) {
    return 'code';
  }

  const cleaned = stripQueryNoise(raw) || raw;
  const name = listed.name.trim();
  if (!name) return 'none';

  if (cleaned === name || raw.includes(name)) return 'exact-name';

  const aliasOfficial =
    officialNameForToken(cleaned)
    ?? officialNameFromAlias(cleaned)
    ?? officialNameFromAlias(raw);
  if (aliasOfficial && (aliasOfficial === name || name.includes(aliasOfficial) || aliasOfficial.includes(name))) {
    return 'alias';
  }

  const variants = nameVariants(name);
  if (variants.includes(cleaned)) return 'variant';

  const lower = cleaned.toLowerCase();
  if (
    name.startsWith(cleaned)
    || name.toLowerCase().startsWith(lower)
    || (cleaned.length >= 2 && (name.includes(cleaned) || name.toLowerCase().includes(lower)))
  ) {
    return 'fuzzy';
  }
  return 'none';
}

/**
 * Voice-only: unique hit that is not code / full name / well-known alias / stem variant
 * should ask 「是 XX 吗？」before open/join/ask. Skip when user edited the search box.
 */
export function needsVoiceCompanyConfirm(opts: {
  fromVoice?: boolean;
  userEdited?: boolean;
  query: string;
  listed: ListedNameCode;
}): boolean {
  if (!opts.fromVoice) return false;
  if (opts.userEdited) return false;
  const kind = listedMatchKind(opts.query, opts.listed);
  return kind === 'fuzzy' || kind === 'none';
}

const YES_RE = /^(确定|确认|是的?|对的?|没错|好的?|可以|行|嗯+|yes|ok)\s*[。.!！]?$/i;
const NO_RE = /^(不是|不对|否|错了|取消|重新|换一个?|no)\s*[。.!！]?$/i;
/** Join-monitor dialog: also accept 加入 / 加入监控池. */
const JOIN_YES_RE = /^(加入(?:监控池)?|确认加入|确定加入)\s*[。.!！]?$/i;

export function parseVoiceConfirmReply(text: string): VoiceConfirmReply {
  const t = text.replace(/\s+/g, '').trim();
  if (!t) return null;
  if (YES_RE.test(t)) return 'yes';
  if (NO_RE.test(t)) return 'no';
  // Soft: 「是贵州茅台」/「确定是茅台」still yes if short
  if (/^(确定|确认|是)/.test(t) && t.length <= 12) return 'yes';
  if (/^(不是|不对|否)/.test(t) && t.length <= 12) return 'no';
  return null;
}

const ORDINAL_WORDS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

/** Parse 「第2个」「2」「二」「东鹏饮料」 against candidates (1-based index). */
export function parseVoicePickChoice(
  text: string,
  candidates: ListedNameCode[],
): VoicePickResult {
  const raw = text.replace(/\s+/g, ' ').trim();
  if (!raw || !candidates.length) return null;
  const compact = raw.replace(/\s+/g, '');

  if (NO_RE.test(compact) || /^(取消|都不是|重新说)/.test(compact)) {
    return { kind: 'cancel' };
  }

  const ordinal =
    compact.match(/^第?\s*([1-9]|10|一|二|两|三|四|五|六|七|八|九|十)\s*(?:个|家|家公司)?$/)
    ?? compact.match(/^([1-9]|10)\s*$/);
  if (ordinal) {
    const token = ordinal[1];
    const n = /^\d+$/.test(token) ? Number(token) : (ORDINAL_WORDS[token] ?? NaN);
    if (Number.isFinite(n) && n >= 1 && n <= candidates.length) {
      return { kind: 'pick', index: n - 1 };
    }
  }

  // Name / code / variant containment — prefer longest unique hit
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    let score = 0;
    if (compact === c.code || compact.includes(c.code)) score = 100;
    else if (compact === c.name || compact.includes(c.name)) score = 90 + c.name.length;
    else {
      for (const v of nameVariants(c.name)) {
        if (compact === v || compact.includes(v)) {
          score = Math.max(score, 50 + v.length);
        }
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { index: i, score };
  }
  if (best) return { kind: 'pick', index: best.index };
  return null;
}

/** Spoken / visible prompt for multi-candidate picker. */
export function buildVoicePickPrompt(candidates: ListedNameCode[]): string {
  const n = candidates.length;
  const lines = candidates
    .slice(0, 8)
    .map((c, i) => `${i + 1}. ${c.name}（${c.code}）`)
    .join('，');
  const more = n > 8 ? `等共 ${n} 家` : '';
  return `检索到多个匹配结果，你想选择哪一个？${lines}${more}。可以说序号或名字。`;
}


/** Spoken yes/no while「加入监控池」dialog is open. */
export function parseVoiceJoinReply(text: string): VoiceConfirmReply {
  const t = text.replace(/\s+/g, '').trim();
  if (!t) return null;
  if (JOIN_YES_RE.test(t)) return 'yes';
  return parseVoiceConfirmReply(text);
}

/** TTS / banner aligned with missing-company dialog actions. */
export function buildVoiceJoinPrompt(listed: ListedNameCode): string {
  return `已识别到「${listed.name}」（${listed.code}），是否加入监控池？可以说加入或取消。`;
}

export function buildVoiceConfirmPrompt(listed: ListedNameCode): string {
  return `是${listed.name}（${listed.code}）吗？可以说确定或不是。`;
}


/** Only an already-routed, successfully matched voice query may replace search. */
export function matchedVoiceSearchText(raw: string, fromVoice: boolean, matchedCount: number): string | null {
  return fromVoice && matchedCount > 0 && raw.trim() ? raw.trim() : null;
}


/** Old search filters must not overwrite the current mic utterance on finalize. */
export function homeVoiceFinalizeText(partial: string, search: string, userEdited: boolean): string {
  return (userEdited ? search : partial).trim();
}
