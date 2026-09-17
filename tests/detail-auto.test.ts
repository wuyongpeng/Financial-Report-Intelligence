import test from 'node:test';
import assert from 'node:assert/strict';
import { isPlaceholderReport, reportIsParsed, reportNeedsDownload, reportNeedsParse, reportParseInFlight } from '../lib/detail-auto';
import type { Report } from '../lib/detail-model';

function report(partial: Partial<Report>): Report {
  return {
    id: 'ann-1',
    code: '600519',
    company_name: '贵州茅台',
    title: '2026年半年度报告',
    report_type: 'semiannual',
    published_at: '2026-08-28',
    parsed_at: null,
    industry: '白酒',
    status: 'downloaded',
    metrics: [],
    ...partial,
  };
}

test('placeholder and parsed reports skip auto parse', () => {
  assert.equal(isPlaceholderReport({ id: 'pending:600519' }), true);
  assert.equal(reportNeedsParse(report({ id: 'pending:600519' })), false);
  assert.equal(reportIsParsed(report({ parsed_at: '2026-08-29', metrics: [] })), true);
  assert.equal(reportNeedsParse(report({ parsed_at: '2026-08-29' })), false);
  assert.equal(reportNeedsParse(report({ metrics: [{ metric: 'revenue', value: 1, unit: '元', source_page: 1, source_label: '营业收入', confidence: 1, verified: 0, period: '2026H1' }] })), false);
});

test('downloaded without metrics needs parse, discovered needs download', () => {
  assert.equal(reportNeedsParse(report({ status: 'downloaded' })), true);
  assert.equal(reportNeedsDownload(report({ status: 'downloaded' })), false);
  assert.equal(reportNeedsDownload(report({ status: 'discovered' })), true);
  assert.equal(reportNeedsParse(report({ status: 'auto_skipped' })), false);
  assert.equal(reportParseInFlight(report({ status: 'parsing' })), true);
});
