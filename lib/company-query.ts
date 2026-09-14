/**
 * Company search: code, Chinese name, and pinyin (full / initials).
 * e.g. hanwu / hwj → 寒武纪
 */
import { pinyin } from 'pinyin-pro';

const cache = new Map<string, { full: string; initials: string }>();

export function pinyinKeys(name: string): { full: string; initials: string } {
  const hit = cache.get(name);
  if (hit) return hit;
  const parts = pinyin(name, { toneType: 'none', type: 'array' }) as string[];
  const full = parts.join('').toLowerCase().replace(/\s+/g, '');
  const initials = parts.map((p) => p[0] ?? '').join('').toLowerCase();
  const keys = { full, initials };
  cache.set(name, keys);
  return keys;
}

/** True when query matches code, name, industry, or pinyin (full / initials / prefix). */
export function matchesCompanyQuery(
  query: string,
  item: { name: string; code: string; industry?: string; industryGroup?: string; theme?: string },
): boolean {
  const raw = query.trim();
  if (!raw) return true;

  const normalized = raw
    .replace(/[（(]\s*(\d{6})\s*[）)]/g, ' $1 ')
    .replace(/[（）()]/g, ' ')
    .trim();

  const parts = normalized.toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return true;

  const py = pinyinKeys(item.name);
  const hay = [
    item.name,
    item.code,
    item.industry ?? '',
    item.industryGroup ?? '',
    item.theme ?? '',
    py.full,
    py.initials,
  ].join(' ').toLowerCase();

  return parts.every((part) => {
    if (hay.includes(part)) return true;
    // pinyin prefix: "han" → hanwuji; "hw" → hwj
    if (/^[a-z]+$/.test(part)) {
      if (py.full.startsWith(part) || py.initials.startsWith(part)) return true;
      if (py.full.includes(part)) return true;
    }
    return false;
  });
}
