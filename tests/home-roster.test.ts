import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homeRosterSourcePreference,
  isHomeRosterQuestion,
  isHomeRosterListQuestion,
  isHomeRosterPresenceQuestion,
  isHomeRosterWorthQuestion,
  parseHomeRosterOpenQuery,
} from '../lib/home-roster-intent';
import {
  answerHomeRosterLocally,
  extractOpenCodeFromAnswer,
} from '../lib/home-roster-answer';
import {
  buildHomeRosterRows,
  formatHomeRosterSnapshot,
  type HomeRosterRow,
} from '../lib/home-roster-snapshot';
import type { CrawlCompanyCoverage } from '../lib/crawl-display';

function fakeCompany(partial: Partial<CrawlCompanyCoverage> & { code: string; name: string }): CrawlCompanyCoverage {
  return {
    industry: partial.industry ?? '白酒',
    industryGroup: partial.industryGroup ?? '消费',
    exchange: partial.exchange ?? 'SSE',
    covered: partial.covered ?? true,
    lastCrawlAt: partial.lastCrawlAt ?? null,
    source: partial.source ?? 'exchange',
    sourceApi: partial.sourceApi ?? 'SSE',
    reportType: partial.reportType ?? 'semiannual',
    reportPeriod: partial.reportPeriod ?? '2026H1',
    parseStatus: partial.parseStatus ?? 'completed',
    parseError: partial.parseError ?? null,
    announcementTitle: partial.announcementTitle ?? null,
    discoveredAt: partial.discoveredAt ?? null,
    downloadedAt: partial.downloadedAt ?? '2026-01-01T00:00:00Z',
    parsedAt: partial.parsedAt ?? '2026-01-01T00:00:00Z',
    rawStatus: partial.rawStatus ?? 'online',
    metricsComplete: partial.metricsComplete ?? true,
    missingMetrics: partial.missingMetrics ?? [],
    metrics: partial.metrics ?? [{ metric: 'revenue', value: 1, unit: '元', period: '2026H1' } as never],
    recentPeriods: partial.recentPeriods ?? ['2026H1'],
    popularity: partial.popularity ?? 1,
    rank: partial.rank ?? 1,
    latestExpectedMissing: partial.latestExpectedMissing,
    ...partial,
  };
}

const sampleRows: HomeRosterRow[] = [
  {
    code: '600519',
    name: '贵州茅台',
    industryGroup: '消费',
    reportPeriod: '2026H1',
    flags: ['已可读', '已收藏'],
  },
  {
    code: '000858',
    name: '五粮液',
    industryGroup: '消费',
    reportPeriod: '2026H1',
    flags: ['已可读', '新期待更新'],
  },
  {
    code: '300750',
    name: '宁德时代',
    industryGroup: '新能源',
    reportPeriod: null,
    flags: ['解析中'],
  },
];

test('isHomeRosterQuestion catches list / presence / worth / open', () => {
  assert.equal(isHomeRosterListQuestion('现在首页有哪些公司'), true);
  assert.equal(isHomeRosterQuestion('当前都收入了哪些公司'), true);
  assert.equal(isHomeRosterPresenceQuestion('茅台在不在'), true);
  assert.equal(isHomeRosterWorthQuestion('哪些值得分析一下'), true);
  assert.equal(parseHomeRosterOpenQuery('打开贵州茅台'), '贵州茅台');
  assert.equal(parseHomeRosterOpenQuery('看看茅台营收怎么样'), null);
  assert.equal(isHomeRosterQuestion('贵州茅台营收增长原因'), false);
});

test('homeRosterSourcePreference picks pool vs visible', () => {
  assert.equal(homeRosterSourcePreference('监控池都收入了哪些'), 'pool');
  assert.equal(homeRosterSourcePreference('现在首页有哪些公司'), 'visible');
});

test('formatHomeRosterSnapshot lists name code flags', () => {
  const companies = [
    fakeCompany({ code: '600519', name: '贵州茅台', latestExpectedMissing: true }),
    fakeCompany({ code: '000858', name: '五粮液', downloadedAt: null, metrics: [], covered: false, parseStatus: 'pending' }),
  ];
  const rows = buildHomeRosterRows(companies, { starred: new Set(['600519']) });
  assert.equal(rows[0]?.flags.includes('已收藏'), true);
  assert.equal(rows[0]?.flags.includes('新期待更新'), true);
  const snap = formatHomeRosterSnapshot(rows, {
    visibleCount: 2,
    filteredCount: 2,
    poolCount: 60,
    industry: '全部',
    viewMode: 'grid',
  });
  assert.match(snap, /首页公司清单快照/);
  assert.match(snap, /贵州茅台（600519）/);
  assert.match(snap, /禁止投资排名/);
});

test('answerHomeRosterLocally lists and checks presence', () => {
  const list = answerHomeRosterLocally('现在首页有哪些公司', sampleRows);
  assert.ok(list?.answer.includes('贵州茅台'));
  assert.equal(list?.mode, 'local');

  const yes = answerHomeRosterLocally('茅台在不在', sampleRows);
  assert.match(yes?.answer ?? '', /在/);
  assert.match(yes?.answer ?? '', /600519/);

  const no = answerHomeRosterLocally('寒武纪在不在', sampleRows);
  assert.match(no?.answer ?? '', /没有/);
});

test('answerHomeRosterLocally worth uses objective signals only', () => {
  const worth = answerHomeRosterLocally('哪些值得分析一下', sampleRows);
  assert.ok(worth?.answer.includes('已收藏') || worth?.answer.includes('新期待更新'));
  assert.match(worth?.answer ?? '', /不下投资结论|客观/);

  const buy = answerHomeRosterLocally('哪些值得买', sampleRows);
  assert.match(buy?.answer ?? '', /不下投资结论/);
});

test('answerHomeRosterLocally open returns code', () => {
  const open = answerHomeRosterLocally('打开贵州茅台', sampleRows);
  assert.equal(open?.openCode, '600519');
});

test('extractOpenCodeFromAnswer reads trailer', () => {
  const code = extractOpenCodeFromAnswer('好的，打开：五粮液（000858）', sampleRows);
  assert.equal(code, '000858');
});
