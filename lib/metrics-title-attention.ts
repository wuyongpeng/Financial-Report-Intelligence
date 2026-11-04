/**
 * /admin/metrics「报告全称」需注意关键字：只标红匹配子串，非整格。
 * 列表可增删；匹配时按长度降序，避免短词抢长词（如「业绩快报」）。
 */

export const METRICS_TITLE_ATTENTION_KEYWORDS = [
  '业绩快报',
  '风险提示',
  '问询函',
  '关注函',
  '预告',
  '更正',
  '修订',
  '补充',
  '取消',
  '摘要',
] as const;

export type TitleAttentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'hit'; text: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split title into plain / attention segments (non-overlapping, longest keyword wins). */
export function splitTitleAttention(title: string): TitleAttentionSegment[] {
  const raw = title ?? '';
  if (!raw) return [];

  const keywords = [...METRICS_TITLE_ATTENTION_KEYWORDS].sort(
    (a, b) => b.length - a.length || a.localeCompare(b, 'zh'),
  );
  const re = new RegExp(`(${keywords.map(escapeRegExp).join('|')})`, 'g');
  const hitSet = new Set<string>(keywords);
  const parts = raw.split(re);
  const out: TitleAttentionSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    out.push(hitSet.has(part) ? { kind: 'hit', text: part } : { kind: 'text', text: part });
  }
  return out;
}

export function titleHasAttentionKeyword(title: string): boolean {
  return splitTitleAttention(title).some((s) => s.kind === 'hit');
}
