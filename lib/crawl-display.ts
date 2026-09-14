/**
 * Shared crawl coverage types and display helpers for home + /crawl.
 * Real data comes from /api/crawl; mock remains a last-resort fallback only.
 */
export type CrawlSourceKind = 'exchange' | 'cninfo';
export type ParseStatus = 'completed' | 'parsing' | 'queued' | 'failed' | 'pending';
export type PeriodCollectState = 'parsed' | 'parsed_partial' | 'downloaded' | 'discovered' | 'expected' | 'failed';
export type CrawlPeriodStatus = {
  period: string;
  state: PeriodCollectState;
  title?: string | null;
  /** announcements.id when this period is already discovered/downloaded */
  announcementId?: string | null;
  /** 该期次实际抓取源：SSE / SZSE / BSE / CNINFO */
  sourceApi?: string | null;
  /** announcements.status 原始管道态 */
  rawStatus?: string | null;
  /** 指标不完整时列出缺项（橙「已解析」悬停用） */
  missingMetrics?: Array<'revenue' | 'net_profit' | 'eps' | 'roe'>;
  /** 硬失败时的错误摘要（红「解析失败」悬停用） */
  parseError?: string | null;
};
export type CrawlReportType = 'annual' | 'semiannual' | 'quarterly' | 'other';
export type IndustryGroup = '科技' | '消费' | '新能源' | '医药' | '金融' | '周期' | '制造军工' | '其他';
export type HeadlineMetricName = 'revenue' | 'net_profit' | 'eps' | 'roe';

export type CrawlMetricPreview = {
  metric: HeadlineMetricName;
  label: string;
  value: number;
  prior?: number;
  unit: string;
};

export type CrawlCompanyCoverage = {
  code: string;
  name: string;
  industry: string;
  industryGroup: IndustryGroup;
  theme?: string;
  exchange: 'SSE' | 'SZSE';
  covered: boolean;
  lastCrawlAt: string | null;
  source: CrawlSourceKind | null;
  /** Raw upstream API label, e.g. SSE / SZSE / CNINFO */
  sourceApi: string | null;
  reportType: CrawlReportType | null;
  reportPeriod: string | null;
  parseStatus: ParseStatus;
  parseError: string | null;
  /** Latest announcement title when available */
  announcementTitle: string | null;
  discoveredAt: string | null;
  downloadedAt: string | null;
  parsedAt: string | null;
  /** Pipeline status string from announcements.status */
  rawStatus: string | null;
  metricsComplete: boolean;
  missingMetrics: HeadlineMetricName[];
  metrics: CrawlMetricPreview[];
  /** Up to a few latest report-period tokens, e.g. 2026Q1 / 2026H1 / 2025FY */
  recentPeriods: string[];
  /** Collected + expected periods so UI does not imply “fully done” from an old H1. */
  periodStatuses?: CrawlPeriodStatus[];
  latestExpectedPeriod?: string;
  latestExpectedMissing?: boolean;
  popularity: number;
  rank: number;
};

export type CrawlStats = {
  universe: number;
  covered: number;
  exchangeCount: number;
  cninfoCount: number;
  exchangePct: number;
  cninfoPct: number;
  lastPollAt: string | null;
  lastPollMinutesAgo: number | null;
  pending: number;
  parsing: number;
  failed: number;
};

export const METRIC_LABELS: Record<HeadlineMetricName, string> = {
  revenue: '营业收入',
  net_profit: '归母净利润',
  eps: '每股收益',
  roe: 'ROE',
};

export const INDUSTRY_CHIPS: IndustryGroup[] = ['科技', '消费', '新能源', '医药', '金融', '周期', '制造军工'];

export function mapIndustryGroup(industry: string, sector?: string | null): IndustryGroup {
  if (sector && (INDUSTRY_CHIPS as string[]).includes(sector)) return sector as IndustryGroup;
  if (/银行|非银金融|保险|金融/.test(industry)) return '金融';
  if (/医药|生物/.test(industry)) return '医药';
  if (/新能源|锂电|光伏|电力设备|储能/.test(industry)) return '新能源';
  if (/电子|计算机|通信|半导体|光通信|AI|存储|消费电子/.test(industry)) return '科技';
  if (/食品饮料|家用电器|农林牧渔|商贸零售|社会服务|传媒|白酒/.test(industry)) return '消费';
  if (/汽车|机械|化工|有色|煤炭|石油|建筑|交通|公用|房地产|材料|制造|军工|周期/.test(industry)) return '周期';
  if (/制造军工|军工/.test(industry)) return '制造军工';
  return '其他';
}

export function sourceKindFromAnnouncement(source: string | null | undefined): CrawlSourceKind | null {
  if (!source) return null;
  if (source === 'CNINFO') return 'cninfo';
  if (source === 'SSE' || source === 'SZSE') return 'exchange';
  return null;
}

export function parseStatusFromAnnouncement(status: string | null | undefined, metricCount: number): ParseStatus {
  if (!status) return 'pending';
  if (status === 'online' || status === 'review') return metricCount > 0 ? 'completed' : 'parsing';
  if (status === 'parsing') return 'parsing';
  // 指标不完整只标注，视为已解析完成（不自动重试）
  if (status === 'parse_partial') return 'completed';
  if (status === 'downloaded') return 'queued'; // 排队解析：已下载，尚未进入解析槽
  if (status === 'discovered' || status === 'downloading') return 'pending';
  if (status === 'download_failed' || status === 'parse_failed' || status === 'parse_parked') return 'failed';
  return 'pending';
}

export function reportTypeFromValue(value: string | null | undefined): CrawlReportType | null {
  if (!value) return null;
  if (value === 'annual' || value === 'semiannual' || value === 'quarterly') return value;
  return 'other';
}

export function sourceBadgeLabel(source: CrawlSourceKind | null) {
  if (source === 'exchange') return '交易所直连';
  if (source === 'cninfo') return '巨潮资讯';
  return '尚未抓取';
}

export function sourceBadgeDetail(source: CrawlSourceKind | null) {
  if (source === 'exchange') return '交易所直连 ✓';
  if (source === 'cninfo') return '巨潮资讯命中 ✓';
  return '监控池内，等待温和抓取';
}

/** PDF 已落到本地（用户口中的「已接入」） */
export function hasDownloadedPdf(item: {
  downloadedAt?: string | null;
  rawStatus?: string | null;
  pdfKey?: string | null;
}) {
  if (item.downloadedAt) return true;
  if (item.pdfKey) return true;
  const s = item.rawStatus ?? '';
  return s === 'downloaded' || s === 'parsing' || s === 'review' || s === 'online' || s === 'parse_partial' || s === 'parse_parked';
}

/** 首页卡片是否展示指标区：已下载且至少有一项核心指标 */
export function hasReadableMetrics(item: { metrics?: unknown[]; downloadedAt?: string | null; rawStatus?: string | null }) {
  return hasDownloadedPdf(item) && Array.isArray(item.metrics) && item.metrics.length > 0;
}

export function parseStatusLabel(status: ParseStatus) {
  if (status === 'completed') return '已解析';
  if (status === 'parsing') return '解析中';
  if (status === 'queued') return '排队解析';
  if (status === 'pending') return '待抓取';
  return '失败';
}

export function periodStateLabel(state: PeriodCollectState) {
  if (state === 'parsed' || state === 'parsed_partial') return '已解析';
  if (state === 'failed') return '解析失败';
  if (state === 'downloaded') return '已下载';
  if (state === 'discovered') return '已发现';
  return '待抓取';
}

export function reportTypeLabel(type: CrawlReportType | null) {
  if (type === 'annual') return '年报';
  if (type === 'semiannual') return '中报';
  if (type === 'quarterly') return '季报';
  if (type === 'other') return '其他';
  return '—';
}

export function reportTypeSortKey(type: CrawlReportType | null, period: string | null) {
  const order = type === 'annual' ? 1 : type === 'semiannual' ? 2 : type === 'quarterly' ? 3 : 9;
  return `${order}:${period ?? ''}`;
}

export function periodDisplay(period: string | null | undefined) {
  if (!period) return '暂无报告期';
  return period.replace('FY', ' 年报').replace('H1', ' 中报').replace('Q1', ' 一季报').replace('Q3', ' 三季报').replace('Q2', ' 二季报');
}

export function formatMetricValue(metric: HeadlineMetricName, value: number) {
  if (!Number.isFinite(value)) return '—';
  if (metric === 'revenue' || metric === 'net_profit') {
    return `${(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿`;
  }
  if (metric === 'roe') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
}

export function yoyChange(current?: number, prior?: number) {
  if (current === undefined || prior === undefined || prior === 0) return undefined;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function freshnessLabel(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '尚未抓取';
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} 分钟前`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)} 小时前`;
  return `${Math.floor(mins / (60 * 24))} 天前`;
}

/** Prefer download time, then discovery, then lastCrawl for card freshness. */
export function freshnessAt(item: {
  downloadedAt?: string | null;
  discoveredAt?: string | null;
  lastCrawlAt?: string | null;
}) {
  return item.downloadedAt || item.discoveredAt || item.lastCrawlAt || null;
}

/** Explain what the relative time on a home card means. */
export function freshnessTooltip(item: {
  downloadedAt?: string | null;
  discoveredAt?: string | null;
  lastCrawlAt?: string | null;
}) {
  if (item.downloadedAt) return '相对时间按 PDF 下载完成时刻计算';
  if (item.discoveredAt) return '相对时间按公告发现时刻计算（尚未下载 PDF）';
  if (item.lastCrawlAt) return '相对时间按最近一次公告时间计算';
  return '尚无抓取记录';
}


export function isUpdatedToday(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function isUpdatedThisWeek(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return false;
  const mins = (now - new Date(iso).getTime()) / 60000;
  return mins <= 60 * 24 * 7;
}


/** Sort key for compact period tokens like 2026Q1 / 2026H1 / 2025FY (newer = larger). */
export function periodTokenKey(token: string) {
  const year = Number(token.match(/20\d{2}/)?.[0] ?? 0);
  const quarter = /FY/.test(token) ? 4 : /H1|Q2/.test(token) ? 2 : /Q3/.test(token) ? 3 : /Q1/.test(token) ? 1 : 0;
  return year * 10 + quarter;
}

/** Keep unique period tokens, newest first, capped. */
export function pickRecentPeriods(tokens: string[], limit = 3) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of tokens) {
    const t = String(raw ?? '').trim();
    if (!/^20\d{2}(FY|H1|Q[1-3])$/.test(t) || seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  unique.sort((a, b) => periodTokenKey(b) - periodTokenKey(a));
  return unique.slice(0, limit);
}

export function computeStats(companies: CrawlCompanyCoverage[], lastPollAt: string | null): CrawlStats {
  const universe = companies.length;
  const withAnnouncement = companies.filter((c) => c.lastCrawlAt);
  const exchangeCount = withAnnouncement.filter((c) => c.source === 'exchange').length;
  const cninfoCount = withAnnouncement.filter((c) => c.source === 'cninfo').length;
  const covered = companies.filter((c) => c.parseStatus === 'completed' || c.metrics.length > 0).length;
  const denom = withAnnouncement.length || 1;
  const exchangePct = withAnnouncement.length ? Math.round((exchangeCount / denom) * 100) : 0;
  const cninfoPct = withAnnouncement.length ? 100 - exchangePct : 0;
  const lastPollMinutesAgo = lastPollAt
    ? Math.max(0, Math.round((Date.now() - new Date(lastPollAt).getTime()) / 60000))
    : null;
  return {
    universe,
    covered,
    exchangeCount,
    cninfoCount,
    exchangePct,
    cninfoPct,
    lastPollAt,
    lastPollMinutesAgo,
    pending: companies.filter((c) => c.parseStatus === 'pending').length,
    parsing: companies.filter((c) => c.parseStatus === 'parsing').length,
    failed: companies.filter((c) => c.parseStatus === 'failed').length,
  };
}
