import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canFillVerdict,
  flattenCrawlFilings,
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
      { period: '2026H1', state: 'parsed', announcementId: 'a1', title: '2026年半年度报告', verdictStatus: null },
      { period: '2025FY', state: 'expected' },
      { period: '最新', state: 'parsed', announcementId: 'a0' },
      { period: '其他', state: 'discovered', announcementId: 'a9', title: '投资者关系活动记录表' },
    ],
  })]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].period, '2026H1');
  assert.equal(rows[0].announcementId, 'a1');
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
