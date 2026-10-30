import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCheckCells,
  currencyYiCandidates,
  pickBestConverted,
  withinTolerance,
  type ThirdPartyRow,
} from '../lib/metrics-check';

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

test('buildCheckCells matches same code+period only (not latest DB period)', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '000333', name: '美的集团', period: '2026H1', revenueYi: 2610.52, netProfitYi: 264.46, eps: 3.52, roe: 11.33 },
    { code: '000333', name: '美的集团', period: '2026Q3', revenueYi: 3690.87, netProfitYi: 413.93, eps: 5.54, roe: 18.06 },
  ];
  const { cells, summary, periodNote } = buildCheckCells(thirdParty, [
    // Latest DB is 2026Q3 with different numbers — must NOT be used for H1 row
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
  assert.match(periodNote, /仅对照第三方已有期次/);
  const h1Rev = cells.find((c) => c.code === '000333' && c.period === '2026H1' && c.metric === 'revenue');
  const q3Rev = cells.find((c) => c.code === '000333' && c.period === '2026Q3' && c.metric === 'revenue');
  assert.equal(h1Rev?.status, 'OK');
  assert.equal(h1Rev?.thirdParty, 2610.52);
  // Q3 third-party 3690.87 vs DB 1073.22 → BAD (same period, wrong numbers), not mixed with H1
  assert.equal(q3Rev?.status, 'BAD');
  assert.equal(q3Rev?.thirdParty, 3690.87);
  assert.equal(summary.revenue.ok, 1);
  assert.equal(summary.revenue.bad, 1);
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

test('buildCheckCells marks MISS when DB lacks that period', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '688981', name: '中芯国际', period: '2026H1', revenueYi: 386.35, netProfitYi: 44.67, eps: 0.56, roe: 2.90 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    // Only a different period in DB
    { code: '688981', name: '中芯国际', period: '2025FY', metric: 'revenue', value: 100, unit: '亿元' },
  ]);
  assert.equal(summary.revenue.miss, 1);
  assert.ok(cells.every((c) => c.period === '2026H1' && c.status === 'MISS'));
});
