import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canBatchParseFiling,
  canFillVerdict,
  estimateDownloadQueueWait,
  flattenCrawlFilings,
  formatQueueLastError,
  openingCompanyLabel,
  periodPrefixMatches,
  uniquePeriodTokens,
  verdictStatusLabel,
  type CrawlCompanyCoverage,
} from '../lib/crawl-display';

function company(partial: Partial<CrawlCompanyCoverage> & Pick<CrawlCompanyCoverage, 'code' | 'name'>): CrawlCompanyCoverage {
  return {
    industry: '科技',
    industryGroup: '科技',
    exchange: 'SSE',
    covered: true,
    lastCrawlAt: null,
    source: 'exchange',
    sourceApi: 'SSE',
    reportType: 'semiannual',
    reportPeriod: '2026H1',
    parseStatus: 'completed',
    parseError: null,
    announcementTitle: null,
    discoveredAt: null,
    downloadedAt: null,
    parsedAt: null,
    rawStatus: 'online',
    metricsComplete: true,
    missingMetrics: [],
    metrics: [],
    recentPeriods: ['2026H1'],
    popularity: 1,
    rank: 1,
    ...partial,
  };
}

test('opening label includes company name and code', () => {
  assert.equal(openingCompanyLabel('601138', '工业富联'), '工业富联 (601138)');
  assert.equal(openingCompanyLabel('601138'), '601138');
});

test('flattenCrawlFilings keeps expected rows so they can be crawled', () => {
  const rows = flattenCrawlFilings([company({
    code: '601138',
    name: '工业富联',
    periodStatuses: [
      { period: '2026H1', state: 'parsed', announcementId: 'a1', title: '2026年半年度报告', verdictStatus: 'ready', verdictGeneratedAt: '2026-09-17T09:00:00Z' },
      { period: '2025FY', state: 'expected' },
      { period: '最新', state: 'parsed', announcementId: 'a0' },
      { period: '其他', state: 'discovered', announcementId: 'a9', title: '投资者关系活动记录表' },
    ],
  })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, '2026H1');
  assert.equal(rows[0].announcementId, 'a1');
  assert.equal(rows[0].verdictGeneratedAt, '2026-09-17T09:00:00Z');
  assert.equal(rows[0].industryGroup, '科技');
  assert.equal(rows[1].period, '2025FY');
  assert.equal(rows[1].announcementId, null);
});

test('period prefix 2026H1 / 2026 filters the compact list', () => {
  assert.equal(periodPrefixMatches('2026H1', '2026H1'), true);
  assert.equal(periodPrefixMatches('2026H1', '2026'), true);
  assert.equal(periodPrefixMatches('2025FY', '2026H1'), false);
  assert.deepEqual(uniquePeriodTokens([{ period: '2026H1' }, { period: '2026H1' }, { period: '2025FY' }]), ['2026H1', '2025FY']);
});

test('only parsed filings can be batch-filled', () => {
  assert.equal(canFillVerdict({ state: 'parsed', announcementId: 'a1' }), true);
  assert.equal(canFillVerdict({ state: 'downloaded', announcementId: 'a1' }), false);
  assert.equal(verdictStatusLabel(null, true), '未生成');
  assert.equal(verdictStatusLabel('ready', true), '已生成');
});

test('batch parse allows downloaded or parsed filings, not expected gaps', () => {
  assert.equal(canBatchParseFiling({ state: 'parsed', announcementId: 'a1' }), true);
  assert.equal(canBatchParseFiling({ state: 'downloaded', announcementId: 'a1' }), true);
  assert.equal(canBatchParseFiling({ state: 'expected', announcementId: null }), false);
  assert.equal(canBatchParseFiling({ state: 'discovered', announcementId: 'a2' }), false);
  assert.equal(canBatchParseFiling({ state: 'discovered', announcementId: 'a2', downloadedAt: '2026-09-01T00:00:00Z' }), true);
});

test('failed download wait uses 30s cooldown plus gate, not 15x pause', () => {
  const now = Date.parse('2026-09-17T07:00:00Z');
  const failed97sAgo = new Date(now - 97_000).toISOString();
  const first = estimateDownloadQueueWait({
    index: 0,
    failed: true,
    updatedAt: failed97sAgo,
    now,
    gateWaitSec: 20,
    pauseSec: 20,
    slotsUsed: 0,
    slotsMax: 5,
    autoEnabled: true,
  });
  assert.equal(first.waitSec, 20);
  const second = estimateDownloadQueueWait({
    index: 1,
    failed: true,
    updatedAt: failed97sAgo,
    now,
    gateWaitSec: 20,
    pauseSec: 20,
    slotsUsed: 0,
    slotsMax: 5,
    autoEnabled: true,
  });
  assert.equal(second.waitSec, 40);
  const justFailed = estimateDownloadQueueWait({
    index: 0,
    failed: true,
    updatedAt: new Date(now).toISOString(),
    now,
    gateWaitSec: 5,
    pauseSec: 20,
    slotsUsed: 0,
    slotsMax: 5,
    autoEnabled: true,
  });
  assert.equal(justFailed.waitSec, 30);
});

test('queue last error is shown in Chinese for common download failures', () => {
  assert.equal(formatQueueLastError('Error: Downloaded object is not a PDF'), '下载内容不是 PDF');
  assert.equal(formatQueueLastError('PDF 404'), 'PDF 请求失败（404）');
  assert.equal(formatQueueLastError('下载超时（5分钟），已退回排队下载'), '下载超时（5分钟），已退回排队下载');
});
