/**
 * Shared crawl coverage types and display helpers for home + /crawl.
 * Real data comes from /api/crawl; mock remains a last-resort fallback only.
 */
export type CrawlSourceKind = 'exchange' | 'cninfo';
export type ParseStatus = 'completed' | 'parsing' | 'failed' | 'pending';
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
  if (status === 'parse_partial') return metricCount > 0 ? 'completed' : 'parsing';
  if (status === 'downloaded') return 'parsing';
  if (status === 'discovered') return 'pending';
  if (status === 'download_failed' || status === 'parse_failed') return 'failed';
  return 'pending';
}

export function reportTypeFromValue(value: string | null | undefined): CrawlReportType | null {
  if (!value) return null;
  if (value === 'annual' || value === 'semiannual' || value === 'quarterly') return value;
  return 'other';
}

export function sourceBadgeLabel(source: CrawlSourceKind | null) {
  if (source === 'exchange') return '交易所直连';
  if (source === 'cninfo') return '巨潮资讯兜底';
  return '尚未抓取';
}

export function sourceBadgeDetail(source: CrawlSourceKind | null) {
  if (source === 'exchange') return '交易所直连 ✓';
  if (source === 'cninfo') return '巨潮资讯兜底命中 ✓';
  return '监控池内，等待温和抓取';
}

export function parseStatusLabel(status: ParseStatus) {
  if (status === 'completed') return '已解析';
  if (status === 'parsing') return '解析中';
  if (status === 'pending') return '待抓取';
  return '失败';
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
