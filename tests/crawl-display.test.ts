import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canBatchParseFiling,
  canFillVerdict,
  describeYoy,
  estimateDownloadQueueWait,
  flattenCrawlFilings,
  filingMatchesSourceFilter,
  filingSourceLabel,
  formatQueueLastError,
  formatYoyBadge,
  openingCompanyLabel,
  periodPrefixMatches,
  resolveYoy,
  sourceKindFromAnnouncement,
  SOURCE_API_FILTER_OPTIONS,
  uniquePeriodTokens,
  verdictStatusLabel,
  yoyChange,
  yoyTone,
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

test('flattenCrawlFilings omits calendar-gap expected rows from the sources list', () => {
  const rows = flattenCrawlFilings([company({
    code: '601138',
    name: '工业富联',
    periodStatuses: [
      { period: '2026H1', state: 'parsed', announcementId: 'a1', title: '2026年半年度报告', verdictStatus: 'ready', verdictGeneratedAt: '2026-09-17T09:00:00Z' },
      { period: '2025FY', state: 'expected' },
      { period: '2026Q1', state: 'expected', announcementId: null },
      { period: '最新', state: 'parsed', announcementId: 'a0' },
      { period: '其他', state: 'discovered', announcementId: 'a9', title: '投资者关系活动记录表' },
    ],
  })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].period, '2026H1');
  assert.equal(rows[0].announcementId, 'a1');
  assert.equal(rows[0].verdictGeneratedAt, '2026-09-17T09:00:00Z');
  assert.equal(rows[0].industryGroup, '科技');
  assert.ok(!rows.some((row) => row.state === 'expected'));
});


test('filingSourceLabel marks expected gaps as 待抓取, not 尚未抓取', () => {
  assert.equal(filingSourceLabel({ state: 'expected', sourceApi: null }), '待抓取');
  assert.equal(filingSourceLabel({ state: 'parsed', sourceApi: 'SSE' }), '上交所');
  assert.equal(filingSourceLabel({ state: 'discovered', sourceApi: null }), '尚未抓取');
});

test('SOURCE_API_FILTER_OPTIONS lists concrete exchanges then cninfo', () => {
  assert.deepEqual(
    SOURCE_API_FILTER_OPTIONS.map((o) => o.value),
    ['SSE', 'SZSE', 'BSE', 'CNINFO'],
  );
  assert.deepEqual(
    SOURCE_API_FILTER_OPTIONS.map((o) => o.label),
    ['上交所', '深交所', '北交所', '巨潮资讯'],
  );
});

test('filingMatchesSourceFilter matches period sourceApi, not company coarse kind', () => {
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'SSE' }, 'all'), true);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'SSE' }, 'SSE'), true);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'sse' }, 'SSE'), true);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'SZSE' }, 'SSE'), false);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'BSE' }, 'BSE'), true);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'CNINFO' }, 'CNINFO'), true);
  assert.equal(filingMatchesSourceFilter({ sourceApi: null }, 'SSE'), false);
  assert.equal(filingMatchesSourceFilter({ sourceApi: 'SSE' }, 'CNINFO'), false);
});

test('sourceKindFromAnnouncement maps BSE to exchange', () => {
  assert.equal(sourceKindFromAnnouncement('BSE'), 'exchange');
  assert.equal(sourceKindFromAnnouncement('SSE'), 'exchange');
  assert.equal(sourceKindFromAnnouncement('CNINFO'), 'cninfo');
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

test('describeYoy: prior zero yields N/A percent and qualitative labels', () => {
  assert.equal(describeYoy(100, 0)?.label, '实现首次盈利');
  assert.equal(describeYoy(100, 0)?.naPercent, true);
  assert.equal(describeYoy(0, 0)?.label, '无变化');
  assert.equal(describeYoy(-50, 0)?.label, '首次亏损');
  assert.equal(yoyChange(100, 0), undefined);
});

test('describeYoy: cross-zero yields 扭亏为盈 / 由盈转亏', () => {
  const turnaround = describeYoy(80, -20)!;
  assert.equal(turnaround.label, '扭亏为盈');
  assert.equal(turnaround.naPercent, true);
  assert.equal(turnaround.absoluteDelta, 100);
  assert.equal(yoyChange(80, -20), undefined);

  const reverse = describeYoy(-10, 40)!;
  assert.equal(reverse.label, '由盈转亏');
  assert.equal(reverse.naPercent, true);
  assert.equal(formatYoyBadge(reverse), '由盈转亏');
});

test('describeYoy: same-sign positive uses prior as denominator and shows >100%', () => {
  const yoy = describeYoy(300, 100)!;
  assert.equal(yoy.kind, 'pct');
  assert.equal(yoy.naPercent, false);
  assert.ok(Math.abs((yoy.pct ?? 0) - 200) < 1e-9);
  assert.match(yoy.label, /同比增长 200\.00%/);
  assert.equal(formatYoyBadge(yoy, 1), '+200.0%');
  assert.equal(yoyTone(yoy), 'up');

  const down = describeYoy(80, 100)!;
  assert.match(down.label, /同比下降 20\.00%/);
  assert.equal(yoyTone(down), 'down');

  const flat = describeYoy(100, 100)!;
  assert.equal(flat.label, '持平');
  assert.equal(flat.kind, 'flat');
});

test('describeYoy: both negative uses abs prior — 减亏 / 增亏', () => {
  const narrowed = describeYoy(-50, -100)!;
  assert.ok(Math.abs((narrowed.pct ?? 0) - 50) < 1e-9);
  assert.match(narrowed.label, /减亏 50\.00%/);
  assert.equal(yoyTone(narrowed), 'up');
  assert.equal(formatYoyBadge(narrowed, 0), '减亏 50%');

  const widened = describeYoy(-150, -100)!;
  assert.ok(Math.abs((widened.pct ?? 0) - (-50)) < 1e-9);
  assert.match(widened.label, /增亏 50\.00%/);
  assert.equal(yoyTone(widened), 'down');
});

test('resolveYoy prefers disclosed YoY percent over cross-report prior', () => {
  const yoy = resolveYoy(100, {
    disclosedYoyPct: -45.57,
    disclosedPrior: 200,
    crossReportPrior: 1,
  })!;
  assert.equal(yoy.source, 'disclosed');
  assert.ok(Math.abs((yoy.pct ?? 0) - (-45.57)) < 1e-9);
  assert.equal(formatYoyBadge(yoy, 2), '-45.57%');
});

test('resolveYoy falls back to disclosed prior then cross-report prior', () => {
  const fromDisclosedPrior = resolveYoy(120, {
    disclosedPrior: 100,
    crossReportPrior: 10,
  })!;
  assert.equal(fromDisclosedPrior.source, 'disclosed');
  assert.ok(Math.abs((fromDisclosedPrior.pct ?? 0) - 20) < 1e-9);

  const fromCross = resolveYoy(120, { crossReportPrior: 100 })!;
  assert.equal(fromCross.source, 'computed');
  assert.ok(Math.abs((fromCross.pct ?? 0) - 20) < 1e-9);

  assert.equal(resolveYoy(120, {}), undefined);
});

test('resolveYoy keeps qualitative label when disclosed amounts cross zero', () => {
  const yoy = resolveYoy(80, {
    disclosedYoyPct: 99999,
    disclosedPrior: -20,
  })!;
  assert.equal(yoy.source, 'disclosed');
  assert.equal(yoy.label, '扭亏为盈');
  assert.equal(yoy.naPercent, true);
});
