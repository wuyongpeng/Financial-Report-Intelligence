import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoCutoffPeriod,
  autoCollectSearchDays,
  announcementMeetsAutoCutoff,
  expectedPeriodsThroughLatest,
  latestExpectedPeriod,
  missingExpectedPeriods,
  nextCoverageBootstrapState,
  periodMeetsAutoCutoff,
  pickGapCompanyCodes,
} from '../lib/ingest-lookback';

test('collect floor is 2025Q1; 2024 is out, 2025Q1 onward is in', () => {
  const now = new Date('2026-09-14T00:00:00+08:00');
  assert.equal(autoCutoffPeriod(now), '2025Q1');
  assert.equal(periodMeetsAutoCutoff('2025Q1', now), true);
  assert.equal(periodMeetsAutoCutoff('2025H1', now), true);
  assert.equal(periodMeetsAutoCutoff('2025Q2', now), true);
  assert.equal(periodMeetsAutoCutoff('2025Q3', now), true);
  assert.equal(periodMeetsAutoCutoff('2025FY', now), true);
  assert.equal(periodMeetsAutoCutoff('2026Q1', now), true);
  assert.equal(periodMeetsAutoCutoff('2026H1', now), true);
  assert.equal(periodMeetsAutoCutoff('2024FY', now), false);
  assert.equal(periodMeetsAutoCutoff('2024H1', now), false);
});

test('announcementMeetsAutoCutoff uses title period, not publish date', () => {
  const now = new Date('2026-09-14T00:00:00+08:00');
  assert.equal(
    announcementMeetsAutoCutoff('某某2024年年度报告', '2026-09-01T00:00:00.000Z', now),
    false,
  );
  assert.equal(
    announcementMeetsAutoCutoff('某某2025年第一季度报告', '2025-04-29T00:00:00.000Z', now),
    true,
  );
});

test('latest expected in Sep is H1; in Nov is Q3; 2025Q1 stays in the hunt list', () => {
  assert.equal(latestExpectedPeriod(new Date('2026-09-14T00:00:00+08:00')), '2026H1');
  assert.equal(latestExpectedPeriod(new Date('2026-11-05T00:00:00+08:00')), '2026Q3');
  const sept = expectedPeriodsThroughLatest(new Date('2026-09-14T00:00:00+08:00'));
  assert.ok(sept.includes('2025Q1') && sept.includes('2025H1') && sept.includes('2026H1'));
  assert.ok(!sept.includes('2026Q3'));
  assert.ok(!sept.includes('2024FY'));
});

test('auto search days reach 2025-01-01', () => {
  const days = autoCollectSearchDays(new Date('2026-09-14T00:00:00+08:00'));
  assert.ok(days >= 400 && days <= 800);
});

test('missing expected periods ignore auto_skipped and treat Q2 as H1', () => {
  const expected = ['2025Q1', '2025H1', '2025Q3', '2025FY', '2026Q1', '2026H1'];
  const missing = missingExpectedPeriods([
    { title: '某某2026年半年度报告', published_at: '2026-08-20', status: 'review' },
    { title: '某某2025年半年度报告', published_at: '2025-08-20', status: 'discovered' },
    { title: '某某2024年年度报告', published_at: '2025-04-01', status: 'auto_skipped' },
  ], expected);
  assert.deepEqual(missing, ['2025Q1', '2025Q3', '2025FY', '2026Q1']);
});

test('gap picker round-robins past the last scanned code', () => {
  const companies = [{ code: '000001' }, { code: '000002' }, { code: '000003' }];
  const missing = new Map([
    ['000001', ['2025Q1']],
    ['000003', ['2025H1']],
  ]);
  assert.deepEqual(pickGapCompanyCodes(companies, missing, '000001', 8), ['000003', '000001']);
  assert.deepEqual(pickGapCompanyCodes(companies, missing, '000003', 1), ['000001']);
});

test('coverage bootstrap stays hunting until every gap company has been scanned once', () => {
  const first = nextCoverageBootstrapState({
    mode: 'bootstrap',
    expectedLatest: '2026H1',
    currentLatest: '2026H1',
    missingCompanyCodes: ['000001', '000002', '000003'],
    huntedCodes: ['000001', '000002'],
  });
  assert.equal(first.mode, 'bootstrap');
  assert.deepEqual(first.remainingToHunt, ['000003']);

  const done = nextCoverageBootstrapState({
    mode: 'bootstrap',
    expectedLatest: '2026H1',
    currentLatest: '2026H1',
    missingCompanyCodes: ['000001', '000003'],
    huntedCodes: ['000001', '000002', '000003'],
  });
  assert.equal(done.mode, 'steady');
  assert.deepEqual(done.remainingToHunt, []);
});

test('coverage bootstrap reopens when a new expected period appears or a new company has gaps', () => {
  const newQuarter = nextCoverageBootstrapState({
    mode: 'steady',
    expectedLatest: '2026H1',
    currentLatest: '2026Q3',
    missingCompanyCodes: ['000001'],
    huntedCodes: ['000001', '000002'],
  });
  assert.equal(newQuarter.mode, 'bootstrap');
  assert.equal(newQuarter.reopen, true);
  assert.deepEqual(newQuarter.remainingToHunt, ['000001']);
  assert.deepEqual(newQuarter.huntedCodes, []);

  const newWatch = nextCoverageBootstrapState({
    mode: 'steady',
    expectedLatest: '2026H1',
    currentLatest: '2026H1',
    missingCompanyCodes: ['600000'],
    huntedCodes: ['000001'],
  });
  assert.equal(newWatch.mode, 'bootstrap');
  assert.equal(newWatch.reopen, false);
  assert.deepEqual(newWatch.remainingToHunt, ['600000']);
});
