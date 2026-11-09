import { pinyinKeys } from './company-query';

/**
 * Admin table quick search — match against joined visible cell text.
 * Case-insensitive; empty query matches all.
 * Latin queries of 2+ letters also match Chinese company names by pinyin
 * (full spelling or initials), e.g. zhongji / zjxc → 中际旭创.
 */

const CHINESE_RUN = /[\u4e00-\u9fff]{2,}/g;

export function matchesQuickSearch(
  query: string,
  parts: Array<string | number | boolean | null | undefined>,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (rowSearchHaystack(parts).includes(q)) return true;
  if (!/^[a-z]+$/.test(q) || q.length < 2) return false;
  for (const part of parts) {
    if (typeof part !== 'string') continue;
    for (const run of part.match(CHINESE_RUN) ?? []) {
      const py = pinyinKeys(run);
      if (py.full.startsWith(q) || py.initials.startsWith(q) || py.full.includes(q)) return true;
    }
  }
  return false;
}

export function rowSearchHaystack(
  parts: Array<string | number | boolean | null | undefined>,
): string {
  return parts
    .map((p) => {
      if (p == null) return '';
      if (typeof p === 'string') return p;
      if (typeof p === 'number' || typeof p === 'boolean') return String(p);
      return '';
    })
    .join(' ')
    .toLowerCase();
}
