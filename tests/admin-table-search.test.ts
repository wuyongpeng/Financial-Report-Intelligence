import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesQuickSearch, rowSearchHaystack } from '../lib/admin-table-search';
import {
  buildMetricCell,
  buildOverviewRows,
  overviewRowMatchesSearch,
  type OverviewDbMetric,
} from '../lib/metrics-overview';
import { checkCellMatchesSearch, type CheckCell } from '../lib/metrics-check';

test('matchesQuickSearch joins visible parts case-insensitively', () => {
  assert.equal(matchesQuickSearch('', ['a', 'b']), true);
  assert.equal(matchesQuickSearch('  ', ['a']), true);
  assert.equal(matchesQuickSearch('暂无同比', ['同比 暂无同比', 'P10']), true);
  assert.equal(matchesQuickSearch('ROE', ['加权平均roe']), true);
  assert.equal(matchesQuickSearch('MISS', ['OK']), false);
  assert.equal(matchesQuickSearch('zjxc', ['中际旭创', '300308']), true);
  assert.equal(matchesQuickSearch('zhongji', ['中际旭创']), true);
  assert.equal(matchesQuickSearch('z', ['中际旭创']), false);
  assert.equal(matchesQuickSearch('xyznot', ['中际旭创']), false);
  assert.equal(rowSearchHaystack([null, undefined, 12, true, 'x']), '  12 true x');
});

test('overviewRowMatchesSearch hits 暂无同比 from display yoy text', () => {
  const rows: OverviewDbMetric[] = [
    {
      code: '601225',
      name: '陕西煤业',
      title: '陕西煤业股份有限公司2025年第三季度报告',
      announcement_id: 'ann-1',
      period: '2025Q3',
      metric: 'roe',
      value: 5.72,
      unit: '%',
      source_page: 3,
      prior_value: null,
      yoy_pct: null,
    },
    {
      code: '601225',
      name: '陕西煤业',
      period: '2025Q3',
      metric: 'revenue',
      value: 1e10,
      unit: '元',
      source_page: 1,
      prior_value: 9e9,
      yoy_pct: 11.1,
    },
    {
      code: '601225',
      name: '陕西煤业',
      period: '2025Q3',
      metric: 'net_profit',
      value: 1e9,
      unit: '元',
      source_page: 1,
      prior_value: 9e8,
      yoy_pct: 10,
    },
    {
      code: '601225',
      name: '陕西煤业',
      period: '2025Q3',
      metric: 'eps',
      value: 0.5,
      unit: '元',
      source_page: 1,
      prior_value: 0.45,
      yoy_pct: 11,
    },
  ];
  const { rows: out } = buildOverviewRows(rows);
  assert.equal(out.length, 1);
  const roe = buildMetricCell('roe', rows[0]);
  assert.equal(roe.yoyText, '暂无同比');
  assert.equal(overviewRowMatchesSearch(out[0], '暂无同比'), true);
  assert.equal(overviewRowMatchesSearch(out[0], '陕西煤业股份有限公司'), true);
  assert.equal(overviewRowMatchesSearch(out[0], '缺核'), false);
  assert.equal(overviewRowMatchesSearch(out[0], 'zzznomatch'), false);
});

test('checkCellMatchesSearch hits status and metric label', () => {
  const cell: CheckCell = {
    code: '600519',
    name: '贵州茅台',
    period: '2025Q3',
    metric: 'revenue',
    metricLabel: '营业总收入',
    thirdParty: 1200,
    dbConverted: 1100,
    dbRaw: '1.1e11 元',
    status: 'BAD',
    relDiff: 0.09,
    note: 'Q3单季已加H1折累计',
  };
  assert.equal(checkCellMatchesSearch(cell, 'BAD'), true);
  assert.equal(checkCellMatchesSearch(cell, '营业总收入'), true);
  assert.equal(checkCellMatchesSearch(cell, 'Q3单季'), true);
  assert.equal(checkCellMatchesSearch(cell, 'MISS'), false);
});
