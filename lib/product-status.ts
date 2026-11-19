import { hasReadableMetrics } from './crawl-display';
import type { CrawlCompanyCoverage } from './crawl-display';

const DELAY_MS = 30 * 60 * 1000;

export type ProductCollectKind = 'ready' | 'running' | 'delayed' | 'unavailable';

export type ProductCollectStatus = {
  kind: ProductCollectKind;
  label: string;
  detail: string;
};

function lastActivityMs(item: CrawlCompanyCoverage) {
  const stamps = [item.parsedAt, item.downloadedAt, item.discoveredAt, item.lastCrawlAt, item.addedAt];
  for (const stamp of stamps) {
    if (!stamp) continue;
    const ms = Date.parse(stamp);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function productCollectStatus(item: CrawlCompanyCoverage, now = Date.now()): ProductCollectStatus {
  if (hasReadableMetrics(item)) {
    const period = item.reportPeriod ? `${item.reportPeriod} 报告` : '报告';
    return { kind: 'ready', label: '已可阅读', detail: `${period}已可阅读，点开即可查看本期分析。` };
  }

  const raw = item.rawStatus ?? '';
  const failed = item.parseStatus === 'failed'
    || raw === 'download_failed'
    || raw === 'parse_failed'
    || raw === 'parse_parked';
  if (failed) {
    return {
      kind: 'unavailable',
      label: '暂不可用',
      detail: '这家公司本期报告暂不可用。系统会继续尝试，完成后会通知你，无需反复刷新。',
    };
  }

  const activity = lastActivityMs(item);
  const stalled = activity != null && now - activity > DELAY_MS;
  if (stalled || (item.latestExpectedMissing && activity != null && now - activity > DELAY_MS)) {
    return {
      kind: 'delayed',
      label: '抓取延迟',
      detail: '抓取比预期更久。完成后会通知你，无需反复刷新。',
    };
  }

  return {
    kind: 'running',
    label: '正在抓取并解析',
    detail: '正在抓取并解析，完成后会通知你，无需反复刷新。',
  };
}
