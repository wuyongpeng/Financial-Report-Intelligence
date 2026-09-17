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
  if (/业绩说明会|投资者说明会|主要经营数据|经营数据公告|H股公告|责任追究|管理办法|资本管理|第三支柱/.test(t)) return 'other';
  if (/半年度报告|半年报|中期报告/.test(t)) return 'semiannual';
  if (/第[一二两三123]季度|[一二三]季度|[一二三]季报|Q[1-3]报告|季度报告|季报/.test(t)) return 'quarterly';
  if (/年度报告/.test(t) || (/(?<!半)年报/.test(t) && !/信息披露|制度/.test(t))) return 'annual';
  return 'other';
}

/** True for the actual 年报/中报/季报 PDF, not 说明会 / 经营数据 / 摘要. */
export function isFullFinancialReport(title: string) {
  const t = compactTitle(title);
  if (/摘要|取消|英文版/.test(t)) return false;
  return classifyReportTitle(title) !== 'other';
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

export function periodCoverageKey(code: string, title: string, publishedAt: unknown) {
  const period = canonicalPeriodFromTitle(title, publishedAt);
  return period ? `${code}:${period}` : null;
}

export function buildCoveredPeriodKeys(rows: Array<{
  code: string;
  title: string;
  publishedAt?: unknown;
  published_at?: unknown;
}>) {
  const keys = new Set<string>();
  for (const row of rows) {
    if (!isFullFinancialReport(row.title)) continue;
    const key = periodCoverageKey(row.code, row.title, row.publishedAt ?? row.published_at);
    if (key) keys.add(key);
  }
  return keys;
}

export type PendingDownloadSkip = 'not-report' | 'duplicate-period';

export function pendingDownloadSkipReason(
  row: { id: string; code: string; title: string; publishedAt?: unknown; published_at?: unknown },
  coveredKeys: Set<string>,
  keepIds?: Set<string>,
): PendingDownloadSkip | null {
  if (keepIds?.has(row.id)) return null;
  if (!isFullFinancialReport(row.title)) return 'not-report';
  const key = periodCoverageKey(row.code, row.title, row.publishedAt ?? row.published_at);
  if (key && coveredKeys.has(key)) return 'duplicate-period';
  return null;
}

export function pendingDownloadSkipMessage(reason: PendingDownloadSkip) {
  if (reason === 'not-report') return '非完整财报（说明会/经营数据/摘要等），跳过下载';
  return '同期货报已从其他来源入库，跳过重复下载';
}
