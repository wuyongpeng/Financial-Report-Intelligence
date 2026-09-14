/**
 * Home hero search helpers: parse company / period hints and decide
 * filter-as-you-type vs deep ask navigation.
 */
import type { CrawlCompanyCoverage, CrawlReportType } from '@/lib/crawl-display';
import ashareUniverseJson from '@/data/ashare-universe.json';
import type { Report } from '@/lib/detail-model';
import { pinyinKeys } from '@/lib/company-query';
import { period as reportPeriodLabel, periodKey } from '@/lib/detail-model';

export type PeriodKind = 'annual' | 'semiannual' | 'quarterly';

export type ParsedPeriod = {
  /** Full year when known, e.g. 2026 from 「26年」or「2026」 */
  year?: number;
  kind?: PeriodKind;
  /** 1 | 2 | 3 — Q2 / 半年报 / 中报 / H1 all map toward mid-year */
  quarter?: 1 | 2 | 3;
  /** Canonical token like 2026H1 / 2026FY / 2026Q1 when year+kind known */
  token?: string;
};

export type ParsedHomeQuery = {
  raw: string;
  companyQuery: string;
  period: ParsedPeriod;
  hasQuestionIntent: boolean;
};

const QUESTION_HINT =
  /是否|怎么|如何|为何|为什么|增长|下降|同比|环比|变化|多少|怎样|什么|哪些|对比|分析|解读|说明|原因|缓慢|加快|看法|值得|关注|买吗|买入|卖出|加仓|减仓|持有|值得买|推荐买|能买|该买|[？?]/

/** Short name/code-only queries stay on live card filter; full questions take the deep path. */
export function hasQuestionIntent(raw: string): boolean {
  const q = raw.trim();
  if (!q) return false;
  if (QUESTION_HINT.test(q)) return true;
  // Longer free-text without a pure code/name shape → treat as ask
  if (q.length >= 12 && !/^\d{6}$/.test(q) && !/^[\u4e00-\u9fffA-Za-z0-9]{1,8}$/.test(q)) return true;
  return false;
}

function expandTwoDigitYear(yy: number): number {
  // 00–79 → 2000–2079; 80–99 → 1980–1999 (A-share reports are modern)
  return yy >= 80 ? 1900 + yy : 2000 + yy;
}

export function parsePeriodHints(raw: string): ParsedPeriod {
  const text = raw.trim();
  const out: ParsedPeriod = {};

  // Accept compact tokens like 2026H1 / 2025FY / 2026Q1 first
  const compact = text.match(/\b(20\d{2})(FY|H1|Q[1-3])\b/i) || text.match(/(20\d{2})(FY|H1|Q[1-3])/i);
  if (compact) {
    out.year = Number(compact[1]);
    const tag = compact[2].toUpperCase();
    if (tag === 'FY') { out.kind = 'annual'; out.token = `${out.year}FY`; }
    else if (tag === 'H1') { out.kind = 'semiannual'; out.quarter = 2; out.token = `${out.year}H1`; }
    else if (tag === 'Q1') { out.kind = 'quarterly'; out.quarter = 1; out.token = `${out.year}Q1`; }
    else if (tag === 'Q2') { out.kind = 'quarterly'; out.quarter = 2; out.token = `${out.year}Q2`; }
    else if (tag === 'Q3') { out.kind = 'quarterly'; out.quarter = 3; out.token = `${out.year}Q3`; }
  }

  const fullYear = text.match(/(20\d{2})\s*年/);
  const fullYearBare = text.match(/\b(20\d{2})\b/);
  const shortYear = text.match(/(?:^|[^\d])(\d{2})\s*年/);
  if (!out.year) {
    if (fullYear) out.year = Number(fullYear[1]);
    else if (shortYear) out.year = expandTwoDigitYear(Number(shortYear[1]));
    else if (fullYearBare) out.year = Number(fullYearBare[1]);
  }

  if (!out.kind) {
    // IMPORTANT: check 半年报 before 年报 — 「半年报」contains「年报」as substring.
    if (/半年报|半年度|中报|(?<![A-Za-z0-9])H1(?![A-Za-z0-9])/i.test(text)) {
      out.kind = 'semiannual';
      out.quarter = 2;
    } else if (/三季报|第三季度|(?<![A-Za-z0-9])Q3(?![A-Za-z0-9])/i.test(text)) {
      out.kind = 'quarterly';
      out.quarter = 3;
    } else if (/一季报|第一季度|(?<![A-Za-z0-9])Q1(?![A-Za-z0-9])/i.test(text)) {
      out.kind = 'quarterly';
      out.quarter = 1;
    } else if (/二季报|第二季度|(?<![A-Za-z0-9])Q2(?![A-Za-z0-9])/i.test(text)) {
      out.kind = 'quarterly';
      out.quarter = 2;
    } else if (/季报|季度/.test(text)) {
      out.kind = 'quarterly';
    } else if (/年度报告|(?<![半中])年报|(?<![A-Za-z0-9])FY(?![A-Za-z0-9])/i.test(text)) {
      out.kind = 'annual';
      out.quarter = undefined;
    }
  }

  if (!out.token) {
    if (out.year && out.kind === 'annual') out.token = `${out.year}FY`;
    else if (out.year && out.kind === 'semiannual') out.token = `${out.year}H1`;
    else if (out.year && out.kind === 'quarterly' && out.quarter) out.token = `${out.year}Q${out.quarter}`;
    else if (out.year && out.quarter === 2 && !out.kind) out.token = `${out.year}H1`;
  }

  return out;
}

/** Strip period / question glue so remaining text can match a company name. */
export function stripQueryNoise(raw: string): string {
  // QUESTION_HINT must be global — a single replace leaves leftovers like「是否缓慢」.
  const questionNoise = new RegExp(QUESTION_HINT.source, 'g');
  return raw
    .replace(/(20\d{2}|\d{2})\s*年/g, ' ')
    .replace(/半年度报告|半年度|半年报|中报|年度报告|年报|一季报|二季报|三季报|季报|第一季度|第二季度|第三季度/g, ' ')
    .replace(/\b(?:FY|H1|Q[1-3])\b/gi, ' ')
    // Keep embedded 6-digit codes; drop surrounding parentheses for name matching.
    .replace(/[（(]\s*(\d{6})\s*[）)]/g, ' $1 ')
    .replace(questionNoise, ' ')
    .replace(/[？?，,。.!！、\s]+/g, ' ')
    .trim();
}

export function parseHomeQuery(raw: string): ParsedHomeQuery {
  const trimmed = raw.trim();
  return {
    raw: trimmed,
    companyQuery: stripQueryNoise(trimmed),
    period: parsePeriodHints(trimmed),
    hasQuestionIntent: hasQuestionIntent(trimmed),
  };
}

export type ListedNameCode = { code: string; name: string };

const ASHARE_UNIVERSE = ashareUniverseJson as ListedNameCode[];

/**
 * Simple precise match against a name/code list (longest name substring wins).
 * Used for both monitor pool and full A-share recognition table — not AI.
 */
export function matchByNameOrCode(
  query: string,
  list: ListedNameCode[],
): ListedNameCode | null {
  const q = query.trim();
  if (!q || !list.length) return null;

  if (/^\d{6}$/.test(q)) {
    return list.find((c) => c.code === q) ?? null;
  }
  // Forms like 三一重工(600031) / 三一重工（600031）
  const parenCode = q.match(/[（(]\s*(\d{6})\s*[）)]/)?.[1] ?? q.match(/(?<!\d)(\d{6})(?!\d)/)?.[1];
  if (parenCode) {
    const byCode = list.find((c) => c.code === parenCode);
    if (byCode) return byCode;
  }

  const byNameLen = [...list].sort(
    (a, b) => b.name.length - a.name.length || a.code.localeCompare(b.code),
  );
  for (const company of byNameLen) {
    if (company.name && q.includes(company.name)) return company;
  }

  const cleaned = stripQueryNoise(q);
  if (cleaned) {
    const lower = cleaned.toLowerCase();
    const exact = list.find(
      (c) => c.name === cleaned || c.name.toLowerCase() === lower || c.code === cleaned,
    );
    if (exact) return exact;
    const starts = list.filter(
      (c) => c.name.startsWith(cleaned) || c.name.toLowerCase().startsWith(lower),
    );
    if (starts.length === 1) return starts[0];
    const contains = list.filter(
      (c) => c.name.includes(cleaned) || c.name.toLowerCase().includes(lower),
    );
    if (contains.length === 1) return contains[0];

    // Pinyin: hanwu / hwj → 寒武纪（多命中时取名称更短的更精确者）
    if (/^[a-z]+$/i.test(lower)) {
      const pyHits = list.filter((c) => {
        const py = pinyinKeys(c.name);
        return (
          py.full === lower
          || py.initials === lower
          || py.full.startsWith(lower)
          || py.initials.startsWith(lower)
          || py.full.includes(lower)
        );
      });
      if (pyHits.length === 1) return pyHits[0];
      if (pyHits.length > 1) {
        const exactFull = pyHits.find((c) => pinyinKeys(c.name).full === lower);
        if (exactFull) return exactFull;
        return [...pyHits].sort((a, b) => a.name.length - b.name.length || a.code.localeCompare(b.code))[0] ?? null;
      }
    }
  }

  return null;
}

/** Identify a listed A-share from free text using the recognition universe (not monitor pool). */
export function resolveListedCompany(
  query: string,
  universe: ListedNameCode[] = ASHARE_UNIVERSE,
): ListedNameCode | null {
  return matchByNameOrCode(query, universe);
}

export function matchCompany(
  query: string,
  coverage: CrawlCompanyCoverage[],
): CrawlCompanyCoverage | null {
  const hit = matchByNameOrCode(query, coverage);
  if (!hit) return null;
  return coverage.find((c) => c.code === hit.code) ?? null;
}

function kindFromReportType(type: string | null | undefined): PeriodKind | undefined {
  if (type === 'annual' || type === 'semiannual' || type === 'quarterly') return type;
  return undefined;
}

function tokenFromReport(report: Report): string {
  const fromMetric = report.metrics[0]?.period;
  if (fromMetric && /20\d{2}(FY|H1|Q[1-3])/.test(fromMetric)) return fromMetric;
  const label = reportPeriodLabel(report);
  const m = label.match(/20\d{2}(FY|H1|Q[1-3])/);
  if (m) return m[0];
  const year = label.match(/20\d{2}/)?.[0];
  if (year && report.report_type === 'annual') return `${year}FY`;
  if (year && report.report_type === 'semiannual') return `${year}H1`;
  if (year && report.report_type === 'quarterly') {
    if (/Q3|三季/.test(label)) return `${year}Q3`;
    if (/Q1|一季/.test(label)) return `${year}Q1`;
    if (/Q2|二季|H1|半年|中报/.test(label)) return `${year}Q2`;
  }
  return label;
}

export function reportMatchesPeriod(report: Report, hint: ParsedPeriod): boolean {
  if (!hint.year && !hint.kind && !hint.token && !hint.quarter) return true;
  const token = tokenFromReport(report);
  if (hint.token && (token === hint.token || token.includes(hint.token))) return true;

  const yearOk = hint.year ? token.includes(String(hint.year)) || report.title.includes(String(hint.year)) : true;
  if (!yearOk) return false;

  const kind = kindFromReportType(report.report_type);
  if (hint.kind && kind && hint.kind !== kind) {
    // Allow Q2 hint to match semiannual H1 disclosures
    if (!(hint.kind === 'quarterly' && hint.quarter === 2 && kind === 'semiannual')) return false;
  }
  if (hint.kind === 'semiannual' && kind === 'semiannual') return yearOk;
  if (hint.kind === 'annual' && kind === 'annual') return yearOk;
  if (hint.quarter) {
    if (hint.quarter === 2 && (/H1|Q2/.test(token) || kind === 'semiannual')) return yearOk;
    if (token.includes(`Q${hint.quarter}`)) return yearOk;
  }
  if (hint.kind && !hint.year) return kind === hint.kind;
  return yearOk && !hint.kind;
}

export function pickBestReport(reports: Report[], hint: ParsedPeriod): Report | null {
  const usable = reports.filter((r) => r.metrics?.length || r.parsed_at);
  const pool = usable.length ? usable : reports;
  if (!pool.length) return null;

  const scored = pool
    .map((r) => ({ r, match: reportMatchesPeriod(r, hint) }))
    .filter((x) => x.match);
  const candidates = scored.length ? scored.map((x) => x.r) : (!hint.token && !hint.year && !hint.kind ? pool : []);
  if (!candidates.length) return null;

  return [...candidates].sort(
    (a, b) => periodKey(b) - periodKey(a) || b.published_at.localeCompare(a.published_at),
  )[0] ?? null;
}

/** Home coverage is latest-only; use it as a fast pre-check before /api/reports. */
export function coverageHasMatchingReport(
  company: CrawlCompanyCoverage,
  hint: ParsedPeriod,
): 'yes' | 'maybe' | 'no' {
  const vague = !hint.year && !hint.kind && !hint.token && !hint.quarter;
  if (vague) {
    return company.metrics.length || company.covered ? 'yes' : 'no';
  }
  if (!company.covered && !company.metrics.length && !company.reportPeriod) return 'no';
  const period = company.reportPeriod ?? '';
  const type = company.reportType as CrawlReportType | null;
  if (hint.token && period === hint.token) return 'yes';
  if (hint.year && period.startsWith(String(hint.year))) {
    if (!hint.kind) return 'yes';
    if (hint.kind === 'semiannual' && (type === 'semiannual' || /H1/.test(period))) return 'yes';
    if (hint.kind === 'annual' && (type === 'annual' || /FY/.test(period))) return 'yes';
    if (hint.kind === 'quarterly' && type === 'quarterly') return 'yes';
    if (hint.kind === 'quarterly' && hint.quarter === 2 && (type === 'semiannual' || /H1|Q2/.test(period))) return 'yes';
  }
  // Latest period on the card may not be the asked one — defer to reports API
  if (company.covered || company.metrics.length) return 'maybe';
  return 'no';
}

export function buildCompanyAskUrl(code: string, question: string, periodToken?: string | null) {
  const params = new URLSearchParams();
  if (question.trim()) params.set('q', question.trim());
  if (periodToken) params.set('period', periodToken);
  const qs = params.toString();
  return qs ? `/${code}?${qs}` : `/${code}`;
}

export function periodLabelZh(hint: ParsedPeriod): string {
  if (hint.token) {
    return hint.token
      .replace('FY', ' 年报')
      .replace('H1', ' 半年报')
      .replace('Q1', ' 一季报')
      .replace('Q2', ' 二季报')
      .replace('Q3', ' 三季报');
  }
  const year = hint.year ? `${hint.year} ` : '';
  if (hint.kind === 'annual') return `${year}年报`.trim();
  if (hint.kind === 'semiannual') return `${year}半年报`.trim();
  if (hint.quarter === 1) return `${year}一季报`.trim();
  if (hint.quarter === 3) return `${year}三季报`.trim();
  if (hint.quarter === 2) return `${year}二季报/半年报`.trim();
  if (hint.kind === 'quarterly') return `${year}季报`.trim();
  return year.trim() || '目标报告期';
}
