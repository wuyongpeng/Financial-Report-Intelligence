/** Date/title helpers for ingest — Postgres may return Date objects. */
export function asIsoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  if (value == null) return new Date().toISOString();
  return String(value);
}

/** Accept "2026年" / "2026 年" / "2025半年度" (year digits without 年); else published date year. */
export function yearFromTitleOrDate(title: string, publishedAt: unknown): string {
  const iso = asIsoDate(publishedAt);
  const fromTitle =
    title.match(/(20\d{2})\s*年/)?.[1]
    ?? title.match(/(20\d{2})\s*(?:半年度|半年报|中期报告|第[一二三两123]季度|[一二三]季度|[一二三]季报|Q[1-3]|年度报告|(?<!半)年报)/)?.[1];
  return fromTitle ?? iso.slice(0, 4);
}

export type FilingReportType = 'annual' | 'semiannual' | 'quarterly' | 'other';

function compactTitle(title: string) {
  return String(title ?? '').replace(/\s+/g, '');
}

/** Classify A-share filing titles. Check 半年/季度 before 年度 — 「一季度报告」must not become 年报.
 * Only formal Q1 / H1 / Q3 / FY filings — 业绩预告/快报等非正式件一律 other. */
export function classifyReportTitle(title: string): FilingReportType {
  const t = compactTitle(title);
  if (/摘要/.test(t) && !/更正/.test(t)) {
    // Abstracts are filtered elsewhere; still classify the underlying type.
  }
  // Bond / equity offerings often mention 季度/年度 in the title but are not full reports.
  if (/可转债|可转换公司债券|转换公司债券|公司债券|债券募集|募集说明书|配股说明书|增发|非公开发行/.test(t)) return 'other';
  if (/业绩说明会|投资者说明会|主要经营数据|经营数据公告|H股公告|责任追究|管理办法|资本管理|第三支柱/.test(t)) return 'other';
  // Earnings preannouncements / flash reports (e.g. 「前三季度业绩预」) — not full filings.
  if (/业绩预[告增减盈亏]|业绩预$|业绩快报|盈利预告|亏损预告/.test(t)) return 'other';
  // Regulatory letters / replies / opinions that mention 年度报告/年报 in the subject — not the filing itself.
  // Must run before annual/semiannual/quarterly matching: 「…年度报告的…问询函的回复」used to become annual.
  if (/问询函|关注函|说明函|监管函|回函/.test(t)) return 'other';
  if (/独立意见|专项说明|核查意见|自查报告/.test(t)) return 'other';
  if (/(?:的回复|回复公告|回复函)/.test(t) && /年度报告|(?<!半)年报|半年度报告|半年报|中期报告|季度报告|季报/.test(t)) return 'other';
  if (/半年度报告|半年报|中期报告/.test(t)) return 'semiannual';
  // Require 报告/季报 so bare 「三季度」in 业绩预 titles cannot match.
  if (/第[一二两三123]季度报告|[一二三]季度报告|[一二三]季报|Q[1-3]报告|季度报告/.test(t)) return 'quarterly';
  if (/年度报告/.test(t) || (/(?<!半)年报/.test(t) && !/信息披露|制度/.test(t))) return 'annual';
  return 'other';
}

/**
 * When the title is「本公司名：另一家股份有限公司…报告」, the PDF is that issuer\'s filing
 * (e.g. 中国平安：平安银行股份有限公司2026年第三季度报告). Used as a minimal ingest guard.
 */
export function titleMatchesCompanyIssuer(companyName: string, title: string) {
  const t = compactTitle(title);
  const m = t.match(/：([^：]+?股份有限公司)/);
  if (!m) return true;
  const issuer = m[1];
  const name = compactTitle(companyName);
  if (!name) return true;
  const issuerCore = issuer.replace(/股份有限公司$/, '');
  const nameCore = name.replace(/股份有限公司|集团有限公司|有限公司|集团|控股$/, '');
  if (!nameCore) return true;
  if (issuer.includes(nameCore) || name.includes(issuerCore)) return true;
  if (issuerCore.includes(nameCore) || nameCore.includes(issuerCore)) return true;
  return false;
}

/** True for the actual 年报/中报/季报 PDF, not 说明会 / 经营数据 / 摘要 / 业绩预告. */
export function isFullFinancialReport(title: string) {
  const t = compactTitle(title);
  if (/摘要|取消|英文版|业绩预|业绩快报/.test(t)) return false;
  // Belt-and-suspenders: letter/reply titles must never pass even if classify drifts.
  if (/问询函|关注函|说明函|监管函|回函|独立意见|专项说明|核查意见/.test(t)) return false;
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
  if (reason === 'not-report') return '非完整财报（问询函/关注函/回复/独立意见/业绩预告/快报/说明会/经营数据/摘要/债券或增发等），跳过下载';
  return '同期货报已从其他来源入库，跳过重复下载';
}
