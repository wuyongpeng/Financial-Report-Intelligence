/**
 * Last-resort crawl-coverage mock. Prefer /api/crawl (Postgres). Home and /crawl
 * only fall back here when the live API is empty or unavailable.
 */
import companiesJson from "@/data/companies.json";
export type {
  CrawlSourceKind,
  ParseStatus,
  CrawlReportType,
  IndustryGroup,
  HeadlineMetricName,
  CrawlMetricPreview,
  CrawlCompanyCoverage,
  CrawlStats,
} from "./crawl-display";
export {
  METRIC_LABELS,
  INDUSTRY_CHIPS,
  mapIndustryGroup,
  sourceKindFromAnnouncement,
  parseStatusFromAnnouncement,
  reportTypeFromValue,
  sourceBadgeLabel,
  sourceBadgeDetail,
  parseStatusLabel,
  reportTypeLabel,
  reportTypeSortKey,
  periodDisplay,
  formatMetricValue,
  yoyChange,
  freshnessLabel,
  isUpdatedToday,
  isUpdatedThisWeek,
  computeStats,
} from "./crawl-display";
import {
  mapIndustryGroup,
  type CrawlCompanyCoverage,
  type CrawlReportType,
  type CrawlSourceKind,
  type HeadlineMetricName,
  type ParseStatus,
  type CrawlStats,
  METRIC_LABELS,
  computeStats,
} from "./crawl-display";

const EXTRA_COMPANIES: Array<{ code: string; name: string; exchange: "SSE" | "SZSE"; industry: string }> = [
  { code: "601012", name: "隆基绿能", exchange: "SSE", industry: "电力设备" },
  { code: "600809", name: "山西汾酒", exchange: "SSE", industry: "食品饮料" },
];

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let state = hash(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function periodFor(rand: () => number): { reportType: CrawlReportType; reportPeriod: string } {
  const roll = rand();
  if (roll < 0.45) return { reportType: "annual", reportPeriod: "2025FY" };
  if (roll < 0.75) return { reportType: "semiannual", reportPeriod: "2026H1" };
  if (roll < 0.9) return { reportType: "quarterly", reportPeriod: "2026Q1" };
  return { reportType: "quarterly", reportPeriod: "2025Q3" };
}

function buildMetrics(rand: () => number, complete: boolean, missing: HeadlineMetricName[]) {
  const baseRev = 80 + rand() * 3200;
  const baseProfit = baseRev * (0.04 + rand() * 0.22) * (rand() > 0.15 ? 1 : -0.4);
  const values: Record<HeadlineMetricName, { value: number; prior: number; unit: string }> = {
    revenue: { value: baseRev * 1e8, prior: baseRev * 1e8 * (0.88 + rand() * 0.28), unit: "元" },
    net_profit: { value: baseProfit * 1e8, prior: baseProfit * 1e8 * (0.85 + rand() * 0.35), unit: "元" },
    eps: { value: Number((0.4 + rand() * 8).toFixed(2)), prior: Number((0.3 + rand() * 7).toFixed(2)), unit: "元" },
    roe: { value: Number((4 + rand() * 28).toFixed(2)), prior: Number((3 + rand() * 26).toFixed(2)), unit: "%" },
  };
  const order: HeadlineMetricName[] = ["revenue", "net_profit", "eps", "roe"];
  return order
    .filter((m) => !missing.includes(m))
    .map((metric) => ({
      metric,
      label: METRIC_LABELS[metric],
      value: values[metric].value,
      prior: values[metric].prior,
      unit: values[metric].unit,
    }))
    .slice(0, complete ? 4 : Math.max(1, 4 - missing.length));
}

const MOCK_NOW = Date.parse("2026-09-11T08:33:00+08:00");
function minutesAgoIso(minutes: number) {
  return new Date(MOCK_NOW - minutes * 60_000).toISOString();
}

function buildCoverage(): CrawlCompanyCoverage[] {
  const rows = (companiesJson as Array<{ code: string; name: string; exchange: "SSE" | "SZSE"; industry: string; sector?: string; rank: number; weight: number }>);
  return rows.map((company, index) => {
    const rand = rng(`crawl:${company.code}`);
    const covered = index < Math.min(rows.length, 12);
    const { reportType, reportPeriod } = periodFor(rand);
    const source: CrawlSourceKind = rand() < 0.62 ? "exchange" : "cninfo";
    const statusRoll = rand();
    let parseStatus: ParseStatus = covered ? (statusRoll > 0.9 ? "failed" : statusRoll > 0.8 ? "parsing" : "completed") : "pending";
    const missingPool: HeadlineMetricName[] = ["roe", "eps", "net_profit", "revenue"];
    const missingCount = parseStatus !== "completed" ? 2 : rand() > 0.85 ? 1 : 0;
    const missingMetrics = missingPool.slice(0, missingCount);
    const metricsComplete = parseStatus === "completed" && missingMetrics.length === 0;
    const lastMinutes = covered ? Math.floor(rand() * 180) + 5 : 0;
    const metrics = parseStatus === "completed" || parseStatus === "parsing"
      ? buildMetrics(rand, metricsComplete, missingMetrics)
      : [];
    const lastCrawlAt = covered ? minutesAgoIso(lastMinutes) : null;
    const sourceApi = covered ? (source === "exchange" ? company.exchange : "CNINFO") : null;
    const title = covered
      ? `${company.name}${reportType === "annual" ? "年度报告" : reportType === "semiannual" ? "半年度报告" : "季度报告"}`
      : null;
    return {
      code: company.code,
      name: company.name,
      industry: company.industry,
      industryGroup: mapIndustryGroup(company.industry, company.sector),
      theme: company.industry,
      exchange: company.exchange,
      covered,
      lastCrawlAt,
      source: covered ? source : null,
      sourceApi,
      reportType: covered ? reportType : null,
      reportPeriod: covered ? reportPeriod : null,
      parseStatus,
      parseError: parseStatus === "failed"
        ? (rand() > 0.5 ? "PDF 下载超时，将于下一轮重试" : "表格抽取缺关键字段，已标记人工复核")
        : null,
      announcementTitle: title,
      discoveredAt: lastCrawlAt,
      downloadedAt: covered && parseStatus !== "pending" ? minutesAgoIso(Math.max(1, lastMinutes - 2)) : null,
      parsedAt: parseStatus === "completed" ? minutesAgoIso(Math.max(1, lastMinutes - 4)) : null,
      rawStatus: parseStatus === "completed" ? "online"
        : parseStatus === "parsing" ? "downloaded"
        : parseStatus === "failed" ? "parse_failed"
        : covered ? "discovered" : null,
      metricsComplete,
      missingMetrics,
      metrics,
      popularity: company.weight,
      rank: company.rank,
    };
  });
}

const COVERAGE = buildCoverage();

export function getCrawlCoverage(): CrawlCompanyCoverage[] {
  return COVERAGE;
}

export function getCoveredCompanies(): CrawlCompanyCoverage[] {
  return COVERAGE.filter((c) => c.covered);
}

export function getCrawlStats(): CrawlStats {
  const newest = COVERAGE.map((c) => c.lastCrawlAt).filter(Boolean).sort().at(-1) ?? null;
  return computeStats(COVERAGE, newest);
}

export function getCompanyCoverage(code: string) {
  return COVERAGE.find((c) => c.code === code);
}

export function mockNow() {
  return MOCK_NOW;
}
