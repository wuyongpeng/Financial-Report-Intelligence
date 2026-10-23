/**
 * Shared crawl coverage types and display helpers for home + /crawl.
 * Real data comes from /api/crawl; mock remains a last-resort fallback only.
 */
import { isCanonicalPeriod } from './ingest-period';
import { periodMeetsAutoCutoff } from './ingest-lookback';
export type CrawlSourceKind = 'exchange' | 'cninfo';
export type ParseStatus = 'completed' | 'parsing' | 'queued' | 'failed' | 'pending';
export type PeriodCollectState = 'parsed' | 'parsed_partial' | 'downloaded' | 'discovered' | 'expected' | 'failed';
export type IndustryGroup = '科技' | '消费' | '新能源' | '医药' | '金融' | '周期' | '制造军工' | '其他';
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
  discoveredAt?: string | null;
  downloadedAt?: string | null;
  parsedAt?: string | null;
  publishedAt?: string | null;
  /** 指标不完整时列出缺项（橙「已解析」悬停用） */
  missingMetrics?: Array<'revenue' | 'net_profit' | 'eps' | 'roe'>;
  /** 硬失败时的错误摘要（红「解析失败」悬停用） */
  parseError?: string | null;
  /** AI 速判落库状态；无记录为 null */
  verdictStatus?: 'ready' | 'pending' | 'failed' | null;
  /** report_verdicts.generated_at；仅 status=ready 时用于列表展示 */
  verdictGeneratedAt?: string | null;
};

export type CrawlFilingRow = {
  key: string;
  code: string;
  name: string;
  industry: string;
  industryGroup: IndustryGroup;
  source: CrawlSourceKind | null;
  period: string;
  title: string | null;
  state: PeriodCollectState;
  announcementId: string | null;
  verdictStatus: 'ready' | 'pending' | 'failed' | null;
  verdictGeneratedAt?: string | null;
  sourceApi?: string | null;
  discoveredAt?: string | null;
  downloadedAt?: string | null;
  parsedAt?: string | null;
  publishedAt?: string | null;
  parseError?: string | null;
};
export type CrawlReportType = 'annual' | 'semiannual' | 'quarterly' | 'other';
export type HeadlineMetricName = 'revenue' | 'net_profit' | 'eps' | 'roe';

export type CrawlMetricPreview = {
  metric: HeadlineMetricName;
  label: string;
  value: number;
  /** Cross-report prior from another announcement (fallback). */
  prior?: number;
  /** Prior-period amount disclosed in this PDF's summary table. */
  disclosedPrior?: number;
  /** YoY % disclosed in this PDF (parentheses = negative). */
  disclosedYoyPct?: number;
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
  /** Newest parsed period tokens for homepage chips, capped at 3 */
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
  if (/银行|非银金融|保险|券商|证券|金融/.test(industry)) return '金融';
  if (/医药|生物|创新药|医疗|中药|疫苗|CXO/.test(industry)) return '医药';
  if (/新能源|锂电|光伏|电力设备|储能|锂矿/.test(industry)) return '新能源';
  if (/电子|计算机|通信|半导体|光通信|AI|存储|消费电子|面板|芯片/.test(industry)) return '科技';
  if (/食品饮料|家用电器|家电|农林牧渔|商贸零售|社会服务|传媒|白酒|乳|调味|啤酒|免税/.test(industry)) return '消费';
  if (/军工|制造军工|轨交|工控|机器人/.test(industry)) return '制造军工';
  if (/汽车|机械|化工|有色|煤炭|石油|建筑|交通|公用|房地产|材料|制造|周期/.test(industry)) return '周期';
  return '其他';
}

export function sourceKindFromAnnouncement(source: string | null | undefined): CrawlSourceKind | null {
  if (!source) return null;
  if (source === 'CNINFO') return 'cninfo';
  if (source === 'SSE' || source === 'SZSE') return 'exchange';
  return null;
}


/** Newest parsed/partial period — homepage cards show this report's metrics. */
export function pickDisplayPeriod(periods: CrawlPeriodStatus[] | undefined): CrawlPeriodStatus | null {
  const list = periods ?? [];
  const parsed = list.filter((p) => p.state === 'parsed' || p.state === 'parsed_partial');
  if (parsed.length) {
    return [...parsed].sort((a, b) => periodTokenKey(b.period) - periodTokenKey(a.period))[0] ?? null;
  }
  const order: Record<PeriodCollectState, number> = {
    parsed: 60, parsed_partial: 55, downloaded: 40, discovered: 30, failed: 20, expected: 10,
  };
  return [...list]
    .sort((a, b) => (order[b.state] ?? 0) - (order[a.state] ?? 0) || periodTokenKey(b.period) - periodTokenKey(a.period))[0]
    ?? null;
}

/** Company-level status from the period table (single source of truth with采集页). */
export function companyParseStatusFromPeriods(periods: CrawlPeriodStatus[] | undefined): ParseStatus {
  const list = periods ?? [];
  if (list.some((p) => p.state === 'parsed' || p.state === 'parsed_partial')) return 'completed';
  if (list.some((p) => p.rawStatus === 'parsing')) return 'parsing';
  if (list.some((p) => p.state === 'downloaded' || p.rawStatus === 'downloaded')) return 'queued';
  if (list.some((p) => p.state === 'failed' || p.rawStatus === 'parse_failed' || p.rawStatus === 'parse_parked' || p.rawStatus === 'download_failed')) {
    return 'failed';
  }
  if (list.some((p) => p.state === 'discovered' || p.rawStatus === 'discovered' || p.rawStatus === 'downloading')) return 'pending';
  return 'pending';
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

export function openingCompanyLabel(code: string, name?: string | null) {
  const n = (name ?? '').trim();
  return n ? `${n} (${code})` : code;
}

export function flattenCrawlFilings(companies: CrawlCompanyCoverage[]): CrawlFilingRow[] {
  const rows: CrawlFilingRow[] = [];
  for (const company of companies) {
    for (const period of company.periodStatuses ?? []) {
      if (!isCanonicalPeriod(period.period) || !periodMeetsAutoCutoff(period.period)) continue;
      rows.push({
        key: period.announcementId ?? `${company.code}:${period.period}`,
        code: company.code,
        name: company.name,
        industry: company.industry,
        industryGroup: company.industryGroup,
        source: company.source,
        period: period.period,
        title: period.title ?? null,
        state: period.state,
        announcementId: period.announcementId ?? null,
        verdictStatus: period.verdictStatus ?? null,
        verdictGeneratedAt: period.verdictStatus === 'ready' ? period.verdictGeneratedAt ?? null : null,
        sourceApi: period.sourceApi,
        discoveredAt: period.discoveredAt,
        downloadedAt: period.downloadedAt,
        parsedAt: period.parsedAt,
        publishedAt: period.publishedAt,
        parseError: period.parseError,
      });
    }
  }
  rows.sort((a, b) => periodTokenKey(b.period) - periodTokenKey(a.period) || a.code.localeCompare(b.code));
  return rows;
}

export function filingToPeriodStatus(row: CrawlFilingRow): CrawlPeriodStatus {
  return {
    period: row.period,
    state: row.state,
    title: row.title,
    announcementId: row.announcementId,
    sourceApi: row.sourceApi,
    discoveredAt: row.discoveredAt,
    downloadedAt: row.downloadedAt,
    parsedAt: row.parsedAt,
    publishedAt: row.publishedAt,
    parseError: row.parseError,
    verdictStatus: row.verdictStatus,
    verdictGeneratedAt: row.verdictGeneratedAt,
  };
}

export function uniquePeriodTokens(rows: Array<{ period: string }>) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (/^20\d{2}(FY|H1|Q[1-3])$/.test(row.period)) seen.add(row.period);
  }
  return [...seen].sort((a, b) => periodTokenKey(b) - periodTokenKey(a));
}

export function periodPrefixMatches(period: string, prefix: string) {
  const needle = prefix.trim().toUpperCase();
  if (!needle) return true;
  return period.toUpperCase().startsWith(needle);
}

export function canFillVerdict(row: { state: PeriodCollectState; announcementId?: string | null }) {
  return Boolean(row.announcementId) && (row.state === 'parsed' || row.state === 'parsed_partial');
}

/** Matches processBacklog: auto retry `download_failed` after 30s (not 15× pause). */
export const DOWNLOAD_FAIL_RETRY_SEC = 30;

export function estimateDownloadQueueWait(input: {
  index: number;
  failed: boolean;
  updatedAt?: string | null;
  now?: number;
  gateWaitSec: number;
  pauseSec: number;
  slotsUsed: number;
  slotsMax: number;
  autoEnabled: boolean;
}): { waitSec?: number; reason: string } {
  if (!input.autoEnabled) {
    return { reason: '自动抓取已关：排队任务暂不开始下载' };
  }
  const unit = Math.max(1, Math.round(input.pauseSec));
  const slotsFull = input.slotsUsed >= input.slotsMax;
  if (slotsFull && !input.failed) {
    return { reason: input.index === 0 ? '等待下载槽空闲' : `排队第 ${input.index + 1} 位` };
  }
  let failRemain = 0;
  if (input.failed) {
    const failedAt = input.updatedAt ? new Date(input.updatedAt).getTime() : NaN;
    failRemain = Number.isFinite(failedAt)
      ? Math.max(0, Math.ceil((failedAt + DOWNLOAD_FAIL_RETRY_SEC * 1000 - (input.now ?? Date.now())) / 1000))
      : 0;
  }
  const gated = Math.max(0, input.gateWaitSec);
  const waitSec = Math.max(failRemain, gated) + input.index * unit;
  if (input.failed) {
    return {
      waitSec: waitSec > 0 ? waitSec : undefined,
      reason: waitSec > 0 ? `上次失败，${waitSec}s 后重试` : '上次失败，即将重试',
    };
  }
  return {
    waitSec: waitSec > 0 ? waitSec : undefined,
    reason: waitSec > 0 ? `约 ${waitSec}s 后可下载` : (input.index === 0 ? '即将领取' : `排队第 ${input.index + 1} 位`),
  };
}

export function canBatchParseFiling(row: { announcementId?: string | null; state: PeriodCollectState; downloadedAt?: string | null }) {
  if (!row.announcementId) return false;
  if (row.downloadedAt) return true;
  return row.state === 'downloaded' || row.state === 'parsed' || row.state === 'parsed_partial' || row.state === 'failed';
}

/** Bulk 批量解析入队：每批最多这么多 announcementId（与 trigger queueOnly 上限一致）。 */
export const BATCH_PARSE_QUEUE_CHUNK = 200;

/** 构造批量解析请求体：只入队、不 immediate，避免 Promise.all 打满 parsing。 */
export function buildBatchParseTriggerBodies(announcementIds: string[], chunkSize = BATCH_PARSE_QUEUE_CHUNK) {
  const unique = [...new Set(announcementIds.map((id) => id.trim()).filter(Boolean))];
  const size = Math.max(1, Math.floor(chunkSize) || BATCH_PARSE_QUEUE_CHUNK);
  const bodies: Array<{ mode: 'parse'; parseOnly: true; queueOnly: true; announcementIds: string[] }> = [];
  for (let i = 0; i < unique.length; i += size) {
    bodies.push({
      mode: 'parse',
      parseOnly: true,
      queueOnly: true,
      announcementIds: unique.slice(i, i + size),
    });
  }
  return bodies;
}


/** Bulk 批量智析入队：每批最多这么多（与 verdict-queue enqueue 上限一致）。 */
export const BATCH_VERDICT_QUEUE_CHUNK = 200;

export type BatchVerdictEnqueueItem = { id: string; refresh?: boolean };

/** 构造批量智析入队请求体：只入队，不逐份 POST+轮询。 */
export function buildBatchVerdictEnqueueBodies(
  items: Array<{ id: string; refresh?: boolean }>,
  chunkSize = BATCH_VERDICT_QUEUE_CHUNK,
) {
  const byId = new Map<string, BatchVerdictEnqueueItem>();
  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) continue;
    const prev = byId.get(id);
    byId.set(id, { id, refresh: Boolean(item.refresh) || Boolean(prev?.refresh) });
  }
  const unique = [...byId.values()];
  const size = Math.max(1, Math.floor(chunkSize) || BATCH_VERDICT_QUEUE_CHUNK);
  const bodies: Array<{ action: 'enqueue'; items: BatchVerdictEnqueueItem[] }> = [];
  for (let i = 0; i < unique.length; i += size) {
    bodies.push({
      action: 'enqueue',
      items: unique.slice(i, i + size),
    });
  }
  return bodies;
}

/** 「排队智析(n)」= 尚未开始跑的排队份数（含 bulk 文件队列），不是全库待补 − 智析中。 */
export function resolveVerdictQueuedBadge(input: {
  pending: number;
  used: number;
  bulkPending: number;
  queuedItemCount: number;
}) {
  return Math.max(
    Math.max(0, input.bulkPending),
    Math.max(0, input.queuedItemCount),
    Math.max(0, input.pending - input.used),
  );
}


export function formatQueueLastError(raw: string | null | undefined) {
  if (!raw) return null;
  const text = raw.replace(/^Error:\s*/i, '').trim();
  if (!text) return null;
  if (/Downloaded object is not a PDF/i.test(text)) return '下载内容不是 PDF';
  if (/交易所拦截了 PDF/.test(text)) return '交易所拦截了 PDF 下载';
  const pdfStatus = text.match(/^PDF (\d+)$/i);
  if (pdfStatus) return `PDF 请求失败（${pdfStatus[1]}）`;
  return text;
}

export function verdictStatusLabel(status: 'ready' | 'pending' | 'failed' | null | undefined, fillable: boolean) {
  if (status === 'ready') return '已生成';
  if (status === 'pending') return '生成中';
  if (status === 'failed') return '失败';
  if (!fillable) return '—';
  return '未生成';
}

export function formatMetricValue(metric: HeadlineMetricName, value: number) {
  if (!Number.isFinite(value)) return '—';
  if (metric === 'revenue' || metric === 'net_profit') {
    return `${(value / 1e8).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 亿`;
  }
  if (metric === 'roe') return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`;
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`;
}

export type YoyKind = 'pct' | 'qualitative' | 'flat';

export type YoyResult = {
  kind: YoyKind;
  /** Signed percent when computed; omitted when percent must show N/A. */
  pct?: number;
  /** Chinese display phrase (full sentence fragment). */
  label: string;
  /** current - prior, always when both inputs are finite. */
  absoluteDelta: number;
  /** True when percent must show N/A (prior zero or cross-zero). */
  naPercent: boolean;
};

/**
 * A-share YoY display rules:
 * 1) prior === 0 → N/A percent + 实现首次盈利 / 无变化 / 首次亏损
 * 2) cross-zero → N/A percent + 扭亏为盈 / 由盈转亏
 * 3) same-sign positive → (本期-基期)/基期；增长/下降/持平（即使 |pct|>100 也照常展示）
 * 4) both negative → (本期-基期)/|基期|；减亏 / 增亏 / 持平
 */
export function describeYoy(current?: number, prior?: number): YoyResult | undefined {
  if (current === undefined || prior === undefined) return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return undefined;
  const absoluteDelta = current - prior;

  if (prior === 0) {
    const label = current > 0 ? '实现首次盈利' : current === 0 ? '无变化' : '首次亏损';
    return { kind: 'qualitative', label, absoluteDelta, naPercent: true };
  }

  if ((current > 0 && prior < 0) || (current < 0 && prior > 0)) {
    const label = prior < 0 && current > 0 ? '扭亏为盈' : '由盈转亏';
    return { kind: 'qualitative', label, absoluteDelta, naPercent: true };
  }

  if (current < 0 && prior < 0) {
    const pct = ((current - prior) / Math.abs(prior)) * 100;
    if (Math.abs(current) === Math.abs(prior) || pct === 0) {
      return { kind: 'flat', pct: 0, label: '持平', absoluteDelta, naPercent: false };
    }
    const absPct = Math.abs(pct);
    const narrowed = Math.abs(current) < Math.abs(prior);
    const label = narrowed ? `减亏 ${absPct.toFixed(2)}%` : `增亏 ${absPct.toFixed(2)}%`;
    return { kind: 'pct', pct, label, absoluteDelta, naPercent: false };
  }

  // Same sign, prior ≠ 0 (both positive here; negatives handled above)
  const pct = ((current - prior) / prior) * 100;
  if (pct === 0) {
    return { kind: 'flat', pct: 0, label: '持平', absoluteDelta, naPercent: false };
  }
  const label = pct > 0 ? `同比增长 ${pct.toFixed(2)}%` : `同比下降 ${Math.abs(pct).toFixed(2)}%`;
  return { kind: 'pct', pct, label, absoluteDelta, naPercent: false };
}

/** Short badge text for cards: +12.3% / 扭亏为盈 / 减亏 50.0% / 持平. */
export function formatYoyBadge(yoy: YoyResult | undefined, digits = 1): string {
  if (!yoy) return '暂无同比';
  if (yoy.naPercent || yoy.kind === 'qualitative') return yoy.label;
  if (yoy.kind === 'flat') return '持平';
  const absPct = Math.abs(yoy.pct ?? 0).toFixed(digits);
  if (yoy.label.startsWith('减亏')) return `减亏 ${absPct}%`;
  if (yoy.label.startsWith('增亏')) return `增亏 ${absPct}%`;
  const pct = yoy.pct ?? 0;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(digits)}%`;
}

/** A-share color hint: up / down / neutral. */
export function yoyTone(yoy: YoyResult | undefined): 'up' | 'down' | 'neutral' {
  if (!yoy) return 'neutral';
  if (yoy.naPercent) {
    if (yoy.label === '扭亏为盈' || yoy.label === '实现首次盈利') return 'up';
    if (yoy.label === '由盈转亏' || yoy.label === '首次亏损') return 'down';
    return 'neutral';
  }
  if (yoy.kind === 'flat' || yoy.pct === undefined || yoy.pct === 0) return 'neutral';
  if (yoy.label.startsWith('减亏')) return 'up';
  if (yoy.label.startsWith('增亏')) return 'down';
  return yoy.pct > 0 ? 'up' : 'down';
}

/** Numeric YoY for sorting / callers that only want a percent; undefined when N/A. */
export function yoyChange(current?: number, prior?: number) {
  const yoy = describeYoy(current, prior);
  if (!yoy || yoy.naPercent || yoy.pct === undefined) return undefined;
  return yoy.pct;
}

export type YoySource = 'disclosed' | 'computed';

export type ResolvedYoy = YoyResult & { source: YoySource };

function yoyFromDisclosedPct(pct: number, current?: number, prior?: number): YoyResult {
  const absoluteDelta = current !== undefined && prior !== undefined
    && Number.isFinite(current) && Number.isFinite(prior)
    ? current - prior
    : 0;
  if (prior !== undefined && Number.isFinite(prior) && current !== undefined && Number.isFinite(current)) {
    const qualitative = describeYoy(current, prior);
    if (qualitative?.naPercent) return qualitative;
    if (current < 0 && prior < 0) {
      if (pct === 0) return { kind: 'flat', pct: 0, label: '持平', absoluteDelta, naPercent: false };
      const absPct = Math.abs(pct);
      const narrowed = Math.abs(current) < Math.abs(prior);
      return {
        kind: 'pct',
        pct,
        label: narrowed ? `减亏 ${absPct.toFixed(2)}%` : `增亏 ${absPct.toFixed(2)}%`,
        absoluteDelta,
        naPercent: false,
      };
    }
  }
  if (pct === 0) return { kind: 'flat', pct: 0, label: '持平', absoluteDelta, naPercent: false };
  const label = pct > 0 ? `同比增长 ${pct.toFixed(2)}%` : `同比下降 ${Math.abs(pct).toFixed(2)}%`;
  return { kind: 'pct', pct, label, absoluteDelta, naPercent: false };
}

/**
 * Prefer in-PDF disclosed YoY / prior over cross-report compute.
 * 1) disclosedYoyPct → authoritative % (qualitative override if amounts cross zero)
 * 2) disclosedPrior → describeYoy(current, disclosedPrior)
 * 3) crossReportPrior → describeYoy(current, crossReportPrior)
 */
export function resolveYoy(
  current: number | undefined,
  opts: {
    disclosedPrior?: number | null;
    disclosedYoyPct?: number | null;
    crossReportPrior?: number | null;
  } = {},
): ResolvedYoy | undefined {
  if (current === undefined || !Number.isFinite(current)) return undefined;
  const dPrior = opts.disclosedPrior;
  const dYoy = opts.disclosedYoyPct;
  const cPrior = opts.crossReportPrior;
  const hasDPrior = dPrior != null && Number.isFinite(dPrior);
  const hasDYoy = dYoy != null && Number.isFinite(dYoy);
  const hasCPrior = cPrior != null && Number.isFinite(cPrior);

  if (hasDYoy) {
    const built = yoyFromDisclosedPct(
      dYoy as number,
      current,
      hasDPrior ? (dPrior as number) : undefined,
    );
    return { ...built, source: 'disclosed' };
  }
  if (hasDPrior) {
    const yoy = describeYoy(current, dPrior as number);
    return yoy ? { ...yoy, source: 'disclosed' } : undefined;
  }
  if (hasCPrior) {
    const yoy = describeYoy(current, cPrior as number);
    return yoy ? { ...yoy, source: 'computed' } : undefined;
  }
  return undefined;
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
