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

export type FilingReportType = 'annual' | 'semiannual' | 'quarterly' | 'other';

function compactTitle(title: string) {
  return String(title ?? '').replace(/\s+/g, '');
}

/** Classify A-share filing titles. Check 半年/季度 before 年度 — 「一季度报告」must not become 年报. */
export function classifyReportTitle(title: string): FilingReportType {
  const t = compactTitle(title);
  if (/摘要/.test(t) && !/更正/.test(t)) {
    // Abstracts are filtered elsewhere; still classify the underlying type.
  }
  if (/半年度|中期报告/.test(t)) return 'semiannual';
  if (/第[一二两三123]季度|[一二三]季度|[一二三]季报|Q[1-3]报告|季度报告|季报/.test(t)) return 'quarterly';
  if (/年度报告|(?<!半)年报/.test(t)) return 'annual';
  return 'other';
}

export function periodFromTitle(title: string, publishedAt: unknown): string {
  const year = yearFromTitleOrDate(title, publishedAt);
  const t = compactTitle(title);
  if (/半年度|中期报告/.test(t) || /第[二两2]季度|二季度|二季报|Q2/.test(t)) return `${year}H1`;
  if (/第[一1]季度|一季度|一季报|Q1/.test(t)) return `${year}Q1`;
  if (/第[三3]季度|三季度|三季报|Q3/.test(t)) return `${year}Q3`;
  if (/季度报告|季报/.test(t)) {
    const month = Number(asIsoDate(publishedAt).slice(5, 7));
    if (month <= 5) return `${year}Q1`;
    if (month <= 9) return `${year}H1`;
    return `${year}Q3`;
  }
  return `${year}FY`;
}

export function reportKindFromPeriod(period: string | null | undefined): FilingReportType | null {
  if (!period) return null;
  if (/FY/.test(period)) return 'annual';
  if (/H1|Q2/.test(period)) return 'semiannual';
  if (/Q[13]/.test(period)) return 'quarterly';
  return null;
}

export function isCanonicalPeriod(period: string | null | undefined): boolean {
  return Boolean(period && /^20\d{2}(FY|H1|Q[1-3])$/.test(period));
}

/** Title-derived period only when the filing type is a real financial report. */
export function canonicalPeriodFromTitle(title: string, publishedAt: unknown): string | null {
  if (classifyReportTitle(title) === 'other') return null;
  const token = periodFromTitle(title, publishedAt);
  return isCanonicalPeriod(token) ? token : null;
}
