/** Date/title helpers for ingest — Postgres may return Date objects. */
export function asIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  if (value == null) return new Date().toISOString();
  return String(value);
}

/** Accept "2026年" and "2026 年"; fall back to published date year. */
export function yearFromTitleOrDate(title: string, publishedAt: unknown): string {
  const iso = asIsoDate(publishedAt);
  return title.match(/(20\d{2})\s*年/)?.[1] ?? iso.slice(0, 4);
}

export function periodFromTitle(title: string, publishedAt: unknown): string {
  const year = yearFromTitleOrDate(title, publishedAt);
  if (/半年度|中期报告/.test(title)) return `${year}H1`;
  if (/第一季度|一季度|一季报/.test(title)) return `${year}Q1`;
  if (/第三季度|三季度|三季报/.test(title)) return `${year}Q3`;
  if (/第二季度|二季度|二季报/.test(title)) return `${year}H1`; // A-share Q2 full text usually maps to mid-year window
  return `${year}FY`;
}
