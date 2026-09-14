import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoCutoffPeriod,
  autoCollectSearchDays,
  announcementMeetsAutoCutoff,
  expectedPeriodsThroughLatest,
  latestExpectedPeriod,
  periodMeetsAutoCutoff,
} from '../lib/ingest-lookback';

test('Sep 2026 cutoff is 2025H1; Q2 aliases H1; 2024 and 2025Q1 excluded', () => {
  const now = new Date('2026-09-14T00:00:00+08:00');
  assert.equal(autoCutoffPeriod(now), '2025H1');
  assert.equal(periodMeetsAutoCutoff('2025H1', now), true);
  assert.equal(periodMeetsAutoCutoff('2025Q2', now), true);
  assert.equal(periodMeetsAutoCutoff('2025Q3', now), true);
  assert.equal(periodMeetsAutoCutoff('2025FY', now), true);
  assert.equal(periodMeetsAutoCutoff('2026Q1', now), true);
  assert.equal(periodMeetsAutoCutoff('2026H1', now), true);
  assert.equal(periodMeetsAutoCutoff('2026Q3', now), true);
  assert.equal(periodMeetsAutoCutoff('2025Q1', now), false);
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
    announcementMeetsAutoCutoff('某某2025年半年度报告', '2025-08-20T00:00:00.000Z', now),
    true,
  );
});

test('latest expected in Sep is H1; in Nov is Q3', () => {
  assert.equal(latestExpectedPeriod(new Date('2026-09-14T00:00:00+08:00')), '2026H1');
  assert.equal(latestExpectedPeriod(new Date('2026-11-05T00:00:00+08:00')), '2026Q3');
  const sept = expectedPeriodsThroughLatest(new Date('2026-09-14T00:00:00+08:00'));
  assert.ok(sept.includes('2025H1') && sept.includes('2026H1'));
  assert.ok(!sept.includes('2026Q3'));
  assert.ok(!sept.includes('2025Q1'));
});

test('auto search days reach previous-year June', () => {
  const days = autoCollectSearchDays(new Date('2026-09-14T00:00:00+08:00'));
  assert.ok(days >= 400 && days <= 800);
});
