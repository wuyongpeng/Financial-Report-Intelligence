import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCheckCells,
  currencyYiCandidates,
  h1PeriodForQ3,
  pickBestConverted,
  pickCanonicalCheckRows,
  pickQ3Comparable,
  withinTolerance,
  type CheckFilingMetric,
  type DbMetricRow,
  type ThirdPartyRow,
} from '../lib/metrics-check';

function filing(partial: Partial<CheckFilingMetric> & Pick<CheckFilingMetric, 'announcement_id' | 'title' | 'metric' | 'value' | 'unit'>): CheckFilingMetric {
  return {
    code: '002230',
    name: '科大讯飞',
    period: '2026H1',
    status: 'online',
    published_at: '2026-08-20T00:00:00.000Z',
    parsed_at: '2026-08-21T00:00:00.000Z',
    ...partial,
  };
}

test('check uses the full report the reader opens, not a higher-confidence percent stub', () => {
  const rows = pickCanonicalCheckRows([
    filing({
      announcement_id: 'stub',
      title: '科大讯飞2026年半年度报告摘要',
      metric: 'revenue',
      value: 5,
      unit: '%',
      published_at: '2026-08-22T00:00:00.000Z',
    }),
    filing({
      announcement_id: 'full',
      title: '科大讯飞股份有限公司2026年半年度报告',
      metric: 'revenue',
      value: 11_623_000_000,
      unit: '元',
    }),
    filing({
      announcement_id: 'full',
      title: '科大讯飞股份有限公司2026年半年度报告',
      metric: 'net_profit',
      value: -204_000_000,
      unit: '元',
    }),
  ]);
  const thirdParty: ThirdPartyRow[] = [
    { code: '002230', name: '科大讯飞', period: '2026H1', revenueYi: 116.23, netProfitYi: -2.04, eps: -0.09, roe: -0.99 },
  ];
  const { cells } = buildCheckCells(thirdParty, rows);
  const revenue = cells.find((cell) => cell.metric === 'revenue');
  assert.equal(revenue?.status, 'OK');
  assert.equal(revenue?.dbRaw, '11,623,000,000 元');
  assert.ok(revenue?.dbConverted != null && Math.abs(revenue.dbConverted - 116.23) < 0.01);
  assert.equal(currencyYiCandidates(5, '%').length, 0);
  const onlyStub = buildCheckCells(thirdParty, [filing({
    announcement_id: 'stub',
    title: '科大讯飞2026年半年度报告摘要',
    metric: 'revenue',
    value: 5,
    unit: '%',
  })]);
  const bad = onlyStub.cells.find((cell) => cell.metric === 'revenue');
  assert.equal(bad?.status, 'BAD');
  assert.equal(bad?.dbConverted, null);
  assert.match(bad?.dbRaw ?? '', /5 %/);
});

test('currencyYiCandidates covers 元/千元/万元 mislabels', () => {
  const c = currencyYiCandidates(78025359, '元');
  assert.ok(c.some((v) => Math.abs(v - 780.25359) < 1e-6));
  assert.ok(c.some((v) => Math.abs(v - 0.78025359) < 1e-6));
});

test('pickBestConverted matches third-party when DB is 千元 labeled as 元', () => {
  const picked = pickBestConverted(780.25, 78025359, '元', 'revenue');
  assert.equal(picked.ok, true);
  assert.ok(Math.abs(picked.converted - 780.25) < 0.02);
});

test('withinTolerance rejects clear mismatches like 茅台营收', () => {
  assert.equal(withinTolerance(907.03, 922.78, 'revenue'), false);
  assert.equal(withinTolerance(445.17, 445.17, 'net_profit'), true);
  assert.equal(withinTolerance(35.57, 35.57, 'eps'), true);
  assert.equal(withinTolerance(16.75, 17.95, 'roe'), false);
});

test('h1PeriodForQ3 maps year Q3 to H1', () => {
  assert.equal(h1PeriodForQ3('2026Q3'), '2026H1');
  assert.equal(h1PeriodForQ3('2026H1'), null);
});

test('pickQ3Comparable folds 美的 Q3 single-quarter revenue with H1', () => {
  const q3: DbMetricRow = {
    code: '000333', period: '2026Q3', metric: 'revenue', value: 107322446000, unit: '元',
  };
  const h1: DbMetricRow = {
    code: '000333', period: '2026H1', metric: 'revenue', value: 261052000000, unit: '元',
  };
  const picked = pickQ3Comparable(3690.87, q3, h1, 'revenue');
  assert.equal(picked.folded, true);
  assert.equal(picked.ok, true);
  assert.ok(Math.abs(picked.converted - 3690.87) < 10);
});

test('pickQ3Comparable does not fold ROE', () => {
  const q3: DbMetricRow = {
    code: '000333', period: '2026Q3', metric: 'roe', value: 6.73, unit: '%',
  };
  const h1: DbMetricRow = {
    code: '000333', period: '2026H1', metric: 'roe', value: 11.33, unit: '%',
  };
  const picked = pickQ3Comparable(18.06, q3, h1, 'roe');
  assert.equal(picked.folded, false);
  assert.equal(picked.ok, false);
  assert.equal(picked.converted, 6.73);
});

test('pickQ3Comparable keeps already-cumulative Q3 without double-adding H1', () => {
  const q3: DbMetricRow = {
    code: '601888', period: '2026Q3', metric: 'revenue', value: 38821000000, unit: '元',
  };
  const h1: DbMetricRow = {
    code: '601888', period: '2026H1', metric: 'revenue', value: 20000000000, unit: '元',
  };
  const picked = pickQ3Comparable(388.21, q3, h1, 'revenue');
  assert.equal(picked.folded, false);
  assert.equal(picked.ok, true);
  assert.ok(Math.abs(picked.converted - 388.21) < 0.02);
});

test('buildCheckCells matches same code+period; Q3 folds H1 for additive metrics', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '000333', name: '美的集团', period: '2026H1', revenueYi: 2610.52, netProfitYi: 264.46, eps: 3.52, roe: 11.33 },
    { code: '000333', name: '美的集团', period: '2026Q3', revenueYi: 3690.87, netProfitYi: 413.93, eps: 5.54, roe: 18.06 },
  ];
  const { cells, summary, periodNote } = buildCheckCells(thirdParty, [
    // Q3 single-quarter in DB
    { code: '000333', name: '美的集团', period: '2026Q3', metric: 'revenue', value: 107322446000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026Q3', metric: 'net_profit', value: 14947334000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026Q3', metric: 'eps', value: 2.02, unit: '元/股' },
    { code: '000333', name: '美的集团', period: '2026Q3', metric: 'roe', value: 6.73, unit: '%' },
    // Matching H1 in DB
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'revenue', value: 261052000000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'net_profit', value: 26446000000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'eps', value: 3.52, unit: '元/股' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'roe', value: 11.33, unit: '%' },
  ]);
  assert.match(periodNote, /仅对照问财第三方已有期次/);
  assert.match(periodNote, /加同公司 H1 折成累计/);
  assert.match(periodNote, /ROE 不折算/);
  const h1Rev = cells.find((c) => c.code === '000333' && c.period === '2026H1' && c.metric === 'revenue');
  const q3Rev = cells.find((c) => c.code === '000333' && c.period === '2026Q3' && c.metric === 'revenue');
  const q3Np = cells.find((c) => c.code === '000333' && c.period === '2026Q3' && c.metric === 'net_profit');
  const q3Eps = cells.find((c) => c.code === '000333' && c.period === '2026Q3' && c.metric === 'eps');
  const q3Roe = cells.find((c) => c.code === '000333' && c.period === '2026Q3' && c.metric === 'roe');
  assert.equal(h1Rev?.status, 'OK');
  assert.equal(h1Rev?.thirdParty, 2610.52);
  assert.equal(q3Rev?.status, 'OK');
  assert.equal(q3Rev?.note, 'Q3单季已加H1折累计');
  assert.equal(q3Rev?.thirdParty, 3690.87);
  assert.ok(q3Rev?.dbConverted != null && Math.abs(q3Rev.dbConverted - 3690.87) < 10);
  assert.equal(q3Np?.status, 'OK');
  assert.equal(q3Np?.note, 'Q3单季已加H1折累计');
  assert.equal(q3Eps?.status, 'OK');
  assert.equal(q3Eps?.note, 'Q3单季已加H1折累计');
  // ROE is not additive — stays BAD vs cumulative third-party
  assert.equal(q3Roe?.status, 'BAD');
  assert.equal(q3Roe?.note, null);
  assert.equal(summary.revenue.ok, 2);
  assert.equal(summary.revenue.bad, 0);
  assert.equal(summary.roe.ok, 1); // H1 only
  assert.equal(summary.roe.bad, 1); // Q3
});

test('buildCheckCells summary counts OK/BAD/MISS; null third-party metric is MISS', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '600519', period: '2026H1', revenueYi: 922.78, netProfitYi: 445.17, eps: 35.57, roe: 17.95 },
    { code: '000063', period: '2026H1', revenueYi: 780.25, netProfitYi: 27.53, eps: 0.58, roe: 3.65 },
    { code: '601888', name: '中国中免', period: '2026Q3', revenueYi: 388.21, netProfitYi: 36.70, eps: 1.77, roe: null },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'revenue', value: 90703260964.48, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'net_profit', value: 44516880421.86, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'eps', value: 35.57, unit: '元/股' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'roe', value: 16.75, unit: '%' },
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'revenue', value: 78025359, unit: '元' },
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'net_profit', value: 2752825, unit: '元' },
    // eps/roe intentionally missing for 000063 → MISS
    // 601888 Q3 has DB but third-party roe is null → MISS for roe only
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'revenue', value: 38821000000, unit: '元' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'net_profit', value: 3670000000, unit: '元' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'eps', value: 1.77, unit: '元/股' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'roe', value: 6.5, unit: '%' },
  ]);
  assert.equal(summary.revenue.ok + summary.revenue.bad + summary.revenue.miss, 3);
  assert.equal(summary.revenue.bad, 1); // 茅台
  assert.equal(summary.revenue.ok, 2); // 中兴 + 中免
  assert.equal(summary.eps.miss, 1); // 000063
  assert.equal(summary.roe.miss, 2); // 000063 missing DB + 601888 null third-party
  assert.ok(cells.some((c) => c.code === '600519' && c.period === '2026H1' && c.metric === 'revenue' && c.status === 'BAD'));
  assert.ok(cells.some((c) => c.code === '000063' && c.period === '2026H1' && c.metric === 'revenue' && c.status === 'OK'));
  assert.ok(cells.some((c) => c.code === '601888' && c.period === '2026Q3' && c.metric === 'roe' && c.status === 'MISS' && c.thirdParty === null));
});

test('buildCheckCells omits code×period when DB has no metrics for that period', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '688981', name: '中芯国际', period: '2026H1', revenueYi: 386.35, netProfitYi: 44.67, eps: 0.56, roe: 2.90 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    // Only a different period in DB (e.g. ops deleted 2026H1 stock metrics)
    { code: '688981', name: '中芯国际', period: '2025FY', metric: 'revenue', value: 100, unit: '亿元' },
  ]);
  assert.equal(cells.length, 0);
  assert.equal(summary.revenue.miss, 0);
  assert.equal(summary.revenue.ok, 0);
  assert.equal(summary.revenue.bad, 0);
});

test('buildCheckCells keeps partial MISS when period still has some DB metrics', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '000063', period: '2026H1', revenueYi: 780.25, netProfitYi: 27.53, eps: 0.58, roe: 3.65 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'revenue', value: 78025359, unit: '元' },
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'net_profit', value: 2752825, unit: '元' },
    // eps/roe intentionally missing → still listed as MISS
  ]);
  assert.equal(cells.length, 4);
  assert.equal(summary.revenue.ok, 1);
  assert.equal(summary.eps.miss, 1);
  assert.equal(summary.roe.miss, 1);
  assert.ok(cells.some((c) => c.metric === 'eps' && c.status === 'MISS'));
});

test('buildCheckCells omits deleted Q3 even if companion H1 remains (fold must not resurrect)', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '000333', name: '美的集团', period: '2026H1', revenueYi: 2610.52, netProfitYi: 264.46, eps: 3.52, roe: 11.33 },
    { code: '000333', name: '美的集团', period: '2026Q3', revenueYi: 3690.87, netProfitYi: 413.93, eps: 5.54, roe: 18.06 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    // Q3 stock cleared; only H1 left
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'revenue', value: 261052000000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'net_profit', value: 26446000000, unit: '元' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'eps', value: 3.52, unit: '元/股' },
    { code: '000333', name: '美的集团', period: '2026H1', metric: 'roe', value: 11.33, unit: '%' },
  ]);
  assert.ok(cells.every((c) => c.period === '2026H1'));
  assert.equal(cells.filter((c) => c.period === '2026Q3').length, 0);
  assert.equal(summary.revenue.ok, 1);
  assert.equal(summary.revenue.miss, 0);
});

test('buildCheckCells keeps Q3 when Q3 DB exists even without H1 companion', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '601888', name: '中国中免', period: '2026Q3', revenueYi: 388.21, netProfitYi: 36.70, eps: 1.77, roe: 6.5 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'revenue', value: 38821000000, unit: '元' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'net_profit', value: 3670000000, unit: '元' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'eps', value: 1.77, unit: '元/股' },
    { code: '601888', name: '中国中免', period: '2026Q3', metric: 'roe', value: 6.5, unit: '%' },
  ]);
  assert.equal(cells.length, 4);
  assert.equal(summary.revenue.ok, 1);
  assert.ok(cells.every((c) => c.period === '2026Q3'));
});

test('buildCheckCells treats H1≡Q2 as present for skip gate', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '600519', name: '贵州茅台', period: '2026H1', revenueYi: 922.78, netProfitYi: 445.17, eps: 35.57, roe: 17.95 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    { code: '600519', name: '贵州茅台', period: '2026Q2', metric: 'revenue', value: 90703260964.48, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026Q2', metric: 'net_profit', value: 44516880421.86, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026Q2', metric: 'eps', value: 35.57, unit: '元/股' },
    { code: '600519', name: '贵州茅台', period: '2026Q2', metric: 'roe', value: 16.75, unit: '%' },
  ]);
  assert.equal(cells.length, 4);
  assert.equal(summary.revenue.bad, 1); // 茅台营收仍对不上
  assert.equal(summary.net_profit.ok, 1);
});
