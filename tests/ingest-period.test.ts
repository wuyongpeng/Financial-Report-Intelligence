import assert from 'node:assert/strict';
import test from 'node:test';
import { asIsoDate, buildCoveredPeriodKeys, canonicalPeriodFromTitle, classifyReportTitle, isFullFinancialReport, pendingDownloadSkipReason, periodFromTitle, yearFromTitleOrDate } from '../lib/ingest-period';

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

test('periodFromTitle: 一季度 / 三季度 is quarterly, not FY', () => {
  assert.equal(periodFromTitle('美的集团2026年一季度报告', '2026-04-29'), '2026Q1');
  assert.equal(periodFromTitle('美的集团股份有限公司2025年三季度报告', '2025-10-30'), '2025Q3');
  assert.equal(periodFromTitle('美的集团2025年第三季度报告', '2025-10-30'), '2025Q3');
  assert.equal(classifyReportTitle('美的集团2026年一季度报告'), 'quarterly');
  assert.equal(classifyReportTitle('美的集团2025年年度报告'), 'annual');
  assert.equal(canonicalPeriodFromTitle('美的集团2026年一季度报告', '2026-04-29'), '2026Q1');
  assert.equal(canonicalPeriodFromTitle('投资者关系活动记录表', '2026-04-29'), null);
});

test('earnings-call and operating-data notices are not full financial reports', () => {
  assert.equal(classifyReportTitle('海天味业关于召开2026年半年度业绩说明会的公告'), 'other');
  assert.equal(classifyReportTitle('海天味业2026年半年度主要经营数据公告'), 'other');
  assert.equal(classifyReportTitle('H股公告-2026中期报告'), 'other');
  assert.equal(classifyReportTitle('京沪高速铁路股份有限公司年报信息披露重大差错责任追究制度'), 'other');
  assert.equal(isFullFinancialReport('建设银行2026年第一季度资本管理第三支柱信息披露报告'), false);
  assert.equal(isFullFinancialReport('海天味业2026年半年度报告'), true);
  assert.equal(isFullFinancialReport('海天味业关于召开2026年半年度业绩说明会的公告'), false);
  assert.equal(canonicalPeriodFromTitle('海天味业2026年半年度报告', '2026-08-27'), '2026H1');
  assert.equal(canonicalPeriodFromTitle('海天味业关于召开2026年半年度业绩说明会的公告', '2026-09-11'), null);
});

test('pending download skips non-reports and already-ingested periods', () => {
  const covered = buildCoveredPeriodKeys([
    { code: '603288', title: '海天味业2026年半年度报告', published_at: '2026-08-27' },
  ]);
  assert.equal(pendingDownloadSkipReason({
    id: 'sse-call',
    code: '603288',
    title: '海天味业关于召开2026年半年度业绩说明会的公告',
    published_at: '2026-09-11',
  }, covered), 'not-report');
  assert.equal(pendingDownloadSkipReason({
    id: 'sse-dup',
    code: '603288',
    title: '海天味业2026年半年度报告',
    published_at: '2026-08-27',
  }, covered), 'duplicate-period');
  assert.equal(pendingDownloadSkipReason({
    id: 'other-period',
    code: '603288',
    title: '海天味业2025年年度报告',
    published_at: '2026-03-27',
  }, covered), null);
});
