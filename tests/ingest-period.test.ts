import assert from 'node:assert/strict';
import test from 'node:test';
import { asIsoDate, periodFromTitle, yearFromTitleOrDate } from '../lib/ingest-period';

test('asIsoDate accepts Date and string', () => {
  assert.equal(asIsoDate('2026-06-30T00:00:00.000Z').slice(0, 10), '2026-06-30');
  assert.equal(asIsoDate(new Date('2026-06-30T12:00:00.000Z')).slice(0, 10), '2026-06-30');
});

test('yearFromTitleOrDate accepts space before 年', () => {
  assert.equal(yearFromTitleOrDate('中国石油2026 年半年度报告', '2025-01-01'), '2026');
  assert.equal(yearFromTitleOrDate('中国石油2026年半年度报告', '2025-01-01'), '2026');
  assert.equal(yearFromTitleOrDate('无年份标题', new Date('2024-08-01T00:00:00.000Z')), '2024');
});

test('periodFromTitle with Date publishedAt does not throw', () => {
  assert.equal(periodFromTitle('某某公司2026 年半年度报告', new Date('2026-08-20')), '2026H1');
  assert.equal(periodFromTitle('某某公司2025年年度报告', '2026-04-01T00:00:00.000Z'), '2025FY');
});
