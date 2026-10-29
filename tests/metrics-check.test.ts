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

test('buildCheckCells summary counts OK/BAD/MISS', () => {
  const thirdParty: ThirdPartyRow[] = [
    { code: '600519', revenueYi: 922.78, netProfitYi: 445.17, eps: 35.57, roe: 17.95 },
    { code: '000063', revenueYi: 780.25, netProfitYi: 27.53, eps: 0.58, roe: 3.65 },
  ];
  const { cells, summary } = buildCheckCells(thirdParty, [
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'revenue', value: 90703260964.48, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'net_profit', value: 44516880421.86, unit: '元' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'eps', value: 35.57, unit: '元/股' },
    { code: '600519', name: '贵州茅台', period: '2026H1', metric: 'roe', value: 16.75, unit: '%' },
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'revenue', value: 78025359, unit: '元' },
    { code: '000063', name: '中兴通讯', period: '2026H1', metric: 'net_profit', value: 2752825, unit: '元' },
    // eps/roe intentionally missing for 000063 → MISS
  ]);
  assert.equal(summary.revenue.ok + summary.revenue.bad + summary.revenue.miss, 2);
  assert.equal(summary.revenue.bad, 1); // 茅台
  assert.equal(summary.revenue.ok, 1); // 中兴 with unit tolerance
  assert.equal(summary.eps.miss, 1);
  assert.equal(summary.roe.miss, 1);
  assert.ok(cells.some((c) => c.code === '600519' && c.metric === 'revenue' && c.status === 'BAD'));
  assert.ok(cells.some((c) => c.code === '000063' && c.metric === 'revenue' && c.status === 'OK'));
});
