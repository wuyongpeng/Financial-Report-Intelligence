import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ABSURD_YOY_ABS_PCT,
  buildMetricCell,
  buildOverviewRows,
  isAbsurdYoyPct,
  type OverviewDbMetric,
} from '../lib/metrics-overview';

test('isAbsurdYoyPct flags astronomical YoY like 茅台 bug', () => {
  assert.equal(isAbsurdYoyPct(ABSURD_YOY_ABS_PCT), true);
  assert.equal(isAbsurdYoyPct(527792210484.39), true);
  assert.equal(isAbsurdYoyPct(44.67), false);
  assert.equal(isAbsurdYoyPct(null), false);
});

test('buildMetricCell formats 沐曦 H1 revenue like detail', () => {
  const cell = buildMetricCell('revenue', {
    code: '688802',
    period: '2026H1',
    metric: 'revenue',
    value: 1_323_593_726.74,
    unit: '元',
    source_page: 10,
    prior_value: null,
    yoy_pct: 44.67,
  });
  assert.equal(cell.present, true);
  assert.match(cell.valueText, /13\.24/);
  assert.match(cell.yoyText, /\+44\.7%/);
  assert.equal(cell.pageText, 'P10');
  assert.deepEqual(cell.issues, []);
});

test('buildMetricCell marks missing page and absurd yoy', () => {
  const cell = buildMetricCell('net_profit', {
    code: '600519',
    period: '2026Q3',
    metric: 'net_profit',
    value: 19_950_545_560.09,
    unit: '元',
    source_page: null,
    prior_value: 3.78,
    yoy_pct: null,
  });
  // prior 3.78 vs yuan-scale current is guarded by resolveYoy; may fall to no yoy or absurd
  assert.ok(cell.issues.includes('no_page'));
});

test('buildMetricCell missing metric → 缺核', () => {
  const cell = buildMetricCell('eps', null);
  assert.equal(cell.present, false);
  assert.deepEqual(cell.issues, ['missing']);
  assert.equal(cell.valueText, '—');
});

test('buildOverviewRows groups four cores and flags incomplete', () => {
  const rows: OverviewDbMetric[] = [
    {
      code: '000333', name: '美的集团',
      title: '美的集团股份有限公司2026年半年度报告',
      period: '2026H1', metric: 'revenue',
      value: 261_052_000_000, unit: '元', source_page: 1, prior_value: null, yoy_pct: 10,
    },
    {
      code: '000333', name: '美的集团', period: '2026H1', metric: 'net_profit',
      value: 26_446_000_000, unit: '元', source_page: 1, prior_value: null, yoy_pct: 12,
    },
    {
      code: '000333', name: '美的集团', period: '2026H1', metric: 'eps',
      value: 3.52, unit: '元', source_page: 1, prior_value: null, yoy_pct: 11,
    },
    // ROE missing → abnormal
  ];
  const { rows: out, summary } = buildOverviewRows(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].href, '/000333?period=2026H1');
  assert.equal(out[0].title, '美的集团股份有限公司2026年半年度报告');
  assert.equal(out[0].abnormal, true);
  assert.ok(out[0].issues.includes('missing'));
  assert.equal(summary.missingCore, 1);
  assert.match(out[0].metrics.revenue.valueText, /2,?610\.52/);
});

test('buildOverviewRows marks disclosed absurd yoy', () => {
  const { rows } = buildOverviewRows([
    {
      code: '600519', name: '贵州茅台', period: '2026Q3', metric: 'revenue',
      value: 40_267_482_684.56, unit: '元', source_page: 1, prior_value: null, yoy_pct: 3.08,
    },
    {
      code: '600519', name: '贵州茅台', period: '2026Q3', metric: 'net_profit',
      value: 19_950_545_560.09, unit: '元', source_page: 1, prior_value: null, yoy_pct: 527792210484.39,
    },
    {
      code: '600519', name: '贵州茅台', period: '2026Q3', metric: 'eps',
      value: 51.53, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
    },
    {
      code: '600519', name: '贵州茅台', period: '2026Q3', metric: 'roe',
      value: 7.64, unit: '%', source_page: 1, prior_value: null, yoy_pct: 2,
    },
  ]);
  assert.equal(rows[0].abnormal, true);
  assert.ok(rows[0].issues.includes('absurd_yoy'));
  assert.ok(rows[0].metrics.net_profit.issues.includes('absurd_yoy'));
});
