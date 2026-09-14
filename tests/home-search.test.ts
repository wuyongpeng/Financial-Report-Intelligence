import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompanyAskUrl,
  hasQuestionIntent,
  matchCompany,
  parseHomeQuery,
  resolveListedCompany,
  parsePeriodHints,
  pickBestReport,
  reportMatchesPeriod,
} from '../lib/home-search';
import { pickRecentPeriods } from '../lib/crawl-display';
import type { CrawlCompanyCoverage } from '../lib/crawl-display';
import type { Report } from '../lib/detail-model';

test('parsePeriodHints: 26年Q2半年报 → 2026H1', () => {
  const p = parsePeriodHints('贵州茅台26年Q2半年报增长是否缓慢');
  assert.equal(p.year, 2026);
  assert.equal(p.kind, 'semiannual');
  assert.equal(p.token, '2026H1');
});

test('parsePeriodHints: compact token 2026H1', () => {
  const p = parsePeriodHints('2026H1');
  assert.equal(p.token, '2026H1');
  assert.equal(p.kind, 'semiannual');
});

test('parseHomeQuery extracts Maotai ask', () => {
  const q = parseHomeQuery('贵州茅台26年Q2半年报增长是否缓慢');
  assert.equal(q.hasQuestionIntent, true);
  assert.match(q.companyQuery, /茅台/);
  assert.equal(q.period.token, '2026H1');
});

test('hasQuestionIntent distinguishes filter vs ask', () => {
  assert.equal(hasQuestionIntent('贵州茅台'), false);
  assert.equal(hasQuestionIntent('600519'), false);
  assert.equal(hasQuestionIntent('增长是否缓慢'), true);
});

test('matchCompany by name and code', () => {
  const coverage = [
    {
      code: '600519',
      name: '贵州茅台',
      industry: '白酒',
      industryGroup: '消费',
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
      metrics: [{ metric: 'revenue', label: '营业收入', value: 1, unit: '元' }],
      recentPeriods: ['2026H1', '2025FY'],
      popularity: 100,
      rank: 16,
    },
  ] as CrawlCompanyCoverage[];
  assert.equal(matchCompany('贵州茅台', coverage)?.code, '600519');
  assert.equal(matchCompany('贵州茅台26年Q2半年报增长是否缓慢', coverage)?.code, '600519');
  assert.equal(matchCompany('600519', coverage)?.code, '600519');
  assert.equal(matchCompany('不存在的公司xyz', coverage), null);
  const parsed = parseHomeQuery('贵州茅台26年Q2半年报增长是否缓慢');
  assert.equal(matchCompany(parsed.companyQuery || parsed.raw, coverage)?.code, '600519');
});

test('pickBestReport prefers matching period', () => {
  const reports = [
    {
      id: 'a',
      code: '600519',
      company_name: '贵州茅台',
      title: '贵州茅台2025年年度报告',
      report_type: 'annual',
      published_at: '2026-03-01',
      parsed_at: '2026-03-02',
      industry: '白酒',
      status: 'online',
      metrics: [{ metric: 'revenue', value: 1, unit: '元', source_page: 1, source_label: null, confidence: 1, verified: 1, period: '2025FY' }],
    },
    {
      id: 'b',
      code: '600519',
      company_name: '贵州茅台',
      title: '贵州茅台2026年半年度报告',
      report_type: 'semiannual',
      published_at: '2026-08-01',
      parsed_at: '2026-08-02',
      industry: '白酒',
      status: 'online',
      metrics: [{ metric: 'revenue', value: 2, unit: '元', source_page: 1, source_label: null, confidence: 1, verified: 1, period: '2026H1' }],
    },
  ] as Report[];
  const hint = parsePeriodHints('2026半年报');
  const best = pickBestReport(reports, hint);
  assert.equal(best?.id, 'b');
  assert.equal(reportMatchesPeriod(reports[1], hint), true);
  assert.equal(reportMatchesPeriod(reports[0], hint), false);
});

test('buildCompanyAskUrl', () => {
  assert.equal(
    buildCompanyAskUrl('600519', '增长是否缓慢', '2026H1'),
    '/600519?q=%E5%A2%9E%E9%95%BF%E6%98%AF%E5%90%A6%E7%BC%93%E6%85%A2&period=2026H1',
  );
});

test('resolveListedCompany recognizes 牧原股份 outside monitor phrasing', () => {
  const hit = resolveListedCompany('牧原股份 买吗');
  assert.equal(hit?.code, '002714');
  assert.equal(hit?.name, '牧原股份');
  assert.equal(resolveListedCompany('完全不存在的公司xyz增长如何'), null);
});

test('resolveListedCompany handles paren-embedded codes', () => {
  assert.equal(resolveListedCompany('三一重工(600031)')?.code, '600031');
  assert.equal(resolveListedCompany('三一重工（600031）')?.code, '600031');
  assert.equal(resolveListedCompany('600031')?.name, '三一重工');
});


test('resolveListedCompany recognizes 沐曦股份 / 688802', () => {
  assert.equal(resolveListedCompany('沐曦股份')?.code, '688802');
  assert.equal(resolveListedCompany('688802')?.code, '688802');
  assert.equal(resolveListedCompany('沐曦股份(688802)')?.code, '688802');
});

test('pickRecentPeriods newest first capped at 3', () => {
  assert.deepEqual(
    pickRecentPeriods(['2025FY', '2026Q1', '2026H1', '2024FY', '2025FY']),
    ['2026H1', '2026Q1', '2025FY'],
  );
});
