import assert from 'node:assert/strict';
import test from 'node:test';
import { listReports } from '../modules/reports/application/list-reports';
import type {
  ReportMetricRecord,
  ReportRecord,
  ReportRepository,
  ReportSelection,
} from '../modules/reports/domain/report-repository';
import {
  mapMetricRow,
  mapReportRow,
  PostgresReportRepository,
  type ReportsDatabase,
} from '../modules/reports/infrastructure/postgres-report-repository';

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: 'current-1',
    code: '600519',
    companyName: '贵州茅台',
    title: '贵州茅台2025年年度报告',
    reportType: 'other',
    publishedAt: '2026-03-01T00:00:00.000Z',
    parsedAt: '2026-03-01T01:00:00.000Z',
    industry: '白酒',
    status: 'online',
    ...overrides,
  };
}

function metric(overrides: Partial<ReportMetricRecord> = {}): ReportMetricRecord {
  return {
    reportId: 'current-1',
    metric: 'revenue',
    value: 100,
    unit: '元',
    period: 'wrong-period',
    sourcePage: 8,
    sourceLabel: '营业收入',
    confidence: 0.99,
    verified: 1,
    ...overrides,
  };
}

class FakeReportRepository implements ReportRepository {
  selections: ReportSelection[] = [];
  priorRequests: string[][] = [];
  metricRequests: string[][] = [];

  constructor(
    private readonly primary: ReportRecord[],
    private readonly prior: ReportRecord[] = [],
    private readonly metrics: ReportMetricRecord[] = [],
  ) {}

  async findReports(selection: ReportSelection) {
    this.selections.push(selection);
    return this.primary;
  }

  async findComparablePriorReports(ids: string[]) {
    this.priorRequests.push(ids);
    return this.prior;
  }

  async findMetricsByReportIds(ids: string[]) {
    this.metricRequests.push(ids);
    return this.metrics;
  }
}

test('listReports selects company reports and composes canonical client DTOs', async () => {
  const repository = new FakeReportRepository([report()], [], [metric()]);
  let observed: ReportRecord[] = [];
  const result = await listReports(
    { code: '600519', limit: 10, view: null },
    repository,
    async rows => { observed = rows; },
  );

  assert.deepEqual(repository.selections, [{ kind: 'company-reports', code: '600519', limit: 10 }]);
  assert.deepEqual(repository.priorRequests, []);
  assert.deepEqual(repository.metricRequests, [['current-1']]);
  assert.deepEqual(observed.map(item => item.id), ['current-1']);
  assert.equal(result.count, 1);
  assert.equal(result.reports[0].report_type, 'annual');
  assert.equal(result.reports[0].metrics[0].period, '2025FY');
  assert.equal(result.reports[0].metrics[0].verified, 1);
});

test('company preview includes a unique comparable prior report before loading metrics', async () => {
  const current = report();
  const prior = report({ id: 'prior-1', title: '贵州茅台2024年年度报告', publishedAt: '2025-03-01T00:00:00.000Z' });
  const repository = new FakeReportRepository(
    [current],
    [prior, current],
    [metric(), metric({ reportId: 'prior-1', period: '2024FY', value: 80 })],
  );
  const result = await listReports({ code: null, limit: 50, view: 'companies' }, repository);

  assert.deepEqual(repository.selections, [{ kind: 'latest-company-reports', limit: 50 }]);
  assert.deepEqual(repository.priorRequests, [['current-1']]);
  assert.deepEqual(repository.metricRequests, [['current-1', 'prior-1']]);
  assert.deepEqual(result.reports.map(item => item.id), ['current-1', 'prior-1']);
  assert.equal(result.count, 2);
});

test('empty report result avoids observer, prior, and metric queries', async () => {
  const repository = new FakeReportRepository([]);
  let observed = false;
  const result = await listReports(
    { code: null, limit: 20, view: null },
    repository,
    async () => { observed = true; },
  );
  assert.deepEqual(result, { source: 'postgresql', count: 0, reports: [] });
  assert.equal(observed, false);
  assert.deepEqual(repository.priorRequests, []);
  assert.deepEqual(repository.metricRequests, []);
});

test('filing label observer failure is non-fatal for read compatibility', async () => {
  const repository = new FakeReportRepository([report()], [], [metric()]);
  const result = await listReports(
    { code: null, limit: 1, view: null },
    repository,
    async () => { throw new Error('repair unavailable'); },
  );
  assert.equal(result.count, 1);
});

test('PostgreSQL row mappers isolate database names, dates, and booleans', () => {
  const mappedReport = mapReportRow({
    id: 'r1',
    code: '000001',
    company_name: '平安银行',
    title: '2025年年度报告',
    report_type: 'annual',
    published_at: new Date('2026-03-01T00:00:00.000Z'),
    parsed_at: null,
    industry: '银行',
    status: 'online',
  });
  assert.equal(mappedReport.companyName, '平安银行');
  assert.equal(mappedReport.publishedAt, '2026-03-01T00:00:00.000Z');
  assert.equal(mappedReport.parsedAt, null);

  const mappedMetric = mapMetricRow({
    announcement_id: 'r1',
    metric: 'roe',
    value: 12.3,
    unit: '%',
    period: '2025FY',
    source_page: 9,
    source_label: '净资产收益率',
    confidence: 0.9,
    verified: true,
  });
  assert.equal(mappedMetric.reportId, 'r1');
  assert.equal(mappedMetric.verified, 1);
});

test('PostgresReportRepository dispatches selections and skips empty IN queries', async () => {
  const calls: string[] = [];
  const database: ReportsDatabase = {
    async findLatestCompanyReports() { calls.push('latest'); return []; },
    async findCompanyReports(code) { calls.push(`company:${code}`); return []; },
    async findRecentReports() { calls.push('recent'); return []; },
    async findComparablePriorReports() { calls.push('prior'); return []; },
    async findMetricsByReportIds() { calls.push('metrics'); return []; },
  };
  const repository = new PostgresReportRepository(database);
  await repository.findReports({ kind: 'latest-company-reports', limit: 1 });
  await repository.findReports({ kind: 'company-reports', code: '600519', limit: 1 });
  await repository.findReports({ kind: 'recent-reports', limit: 1 });
  await repository.findComparablePriorReports([]);
  await repository.findMetricsByReportIds([]);
  assert.deepEqual(calls, ['latest', 'company:600519', 'recent']);
});
