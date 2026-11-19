import { hasReadableMetrics, type CrawlCompanyCoverage, type CrawlMetricPreview } from './crawl-display';
import { formatMetricFinanceAmount } from './format-finance-amount';
import { latestExpectedPeriod } from './ingest-lookback';
import { productCollectStatus } from './product-status';

export type DigestItem = {
  code: string;
  name: string;
  period: string | null;
  kind: 'ready' | 'running' | 'delayed' | 'unavailable';
  statusLabel: string;
  points: string[];
  href: string;
};

export type WatchlistDigest = {
  period: string;
  ready: DigestItem[];
  waiting: DigestItem[];
  summary: string;
};

function metricLine(metric: CrawlMetricPreview) {
  const amount = formatMetricFinanceAmount(metric.metric, metric.value);
  const yoy = metric.disclosedYoyPct;
  if (typeof yoy === 'number' && Number.isFinite(yoy)) {
    const sign = yoy > 0 ? '+' : '';
    return `${metric.label} ${amount}，同比 ${sign}${yoy.toFixed(1)}%`;
  }
  return `${metric.label} ${amount}`;
}

function pointsFor(item: CrawlCompanyCoverage) {
  const preferred = ['revenue', 'net_profit', 'roe', 'eps'];
  const lines: string[] = [];
  for (const name of preferred) {
    const metric = item.metrics.find((row) => row.metric === name);
    if (metric) lines.push(metricLine(metric));
    if (lines.length >= 3) break;
  }
  return lines;
}

export function buildWatchlistDigest(items: CrawlCompanyCoverage[], now = new Date()): WatchlistDigest {
  const period = latestExpectedPeriod(now);
  const ready: DigestItem[] = [];
  const waiting: DigestItem[] = [];
  for (const item of items) {
    const status = productCollectStatus(item, now.getTime());
    const digestItem: DigestItem = {
      code: item.code,
      name: item.name,
      period: item.reportPeriod,
      kind: status.kind,
      statusLabel: status.label,
      points: status.kind === 'ready' ? pointsFor(item) : [],
      href: item.reportPeriod ? `/${item.code}?period=${encodeURIComponent(item.reportPeriod)}` : `/${item.code}`,
    };
    if (status.kind === 'ready' && (item.reportPeriod === period || hasReadableMetrics(item))) {
      ready.push(digestItem);
    } else if (status.kind !== 'ready') {
      waiting.push(digestItem);
    } else {
      ready.push(digestItem);
    }
  }

  const bits: string[] = [];
  if (!items.length) {
    bits.push('还没有自选公司。搜索后即可加入，加入后会自动抓取，完成后会通知你。');
  } else {
    bits.push(`当前关注期次 ${period}。`);
    if (ready.length) bits.push(`已出报告 ${ready.length} 家：${ready.map((row) => row.name).join('、')}。`);
    const delayed = waiting.filter((row) => row.kind === 'delayed');
    const unavailable = waiting.filter((row) => row.kind === 'unavailable');
    const running = waiting.filter((row) => row.kind === 'running');
    if (running.length) bits.push(`正在抓取 ${running.length} 家，完成后会通知你。`);
    if (delayed.length) bits.push(`抓取延迟 ${delayed.length} 家。`);
    if (unavailable.length) bits.push(`暂不可用 ${unavailable.length} 家。`);
    bits.push('以下只陈述财报数据，不构成投资建议。');
  }

  return { period, ready, waiting, summary: bits.join('') };
}
