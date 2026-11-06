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
      announcement_id: 'ann-midea-h1',
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
  assert.equal(out[0].announcementId, 'ann-midea-h1');
  assert.equal(out[0].acked, false);
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

test('buildOverviewRows keeps announcementId for discard of wrong grab', () => {
  const { rows } = buildOverviewRows([
    {
      code: '000792',
      name: '盐湖股份',
      title: '青海盐湖工业股份有限公司2026年前三季度业绩预告',
      announcement_id: 'ann-yanhu-preview',
      period: '2026Q3',
      metric: 'net_profit',
      value: 1, unit: '元', source_page: null, prior_value: null, yoy_pct: null,
    },
  ]);
  assert.equal(rows[0].announcementId, 'ann-yanhu-preview');
  assert.equal(rows[0].title.includes('业绩预告'), true);
  assert.equal(rows[0].abnormal, true);
});

test('acked true surge drops from abnormal summary (天齐)', () => {
  const dbRows: OverviewDbMetric[] = [
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'revenue',
      value: 1e9, unit: '元', source_page: 1, prior_value: null, yoy_pct: 10,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'net_profit',
      value: 1e8, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1324,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'eps',
      value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 10,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'roe',
      value: 5, unit: '%', source_page: 1, prior_value: null, yoy_pct: 10,
    },
  ];
  const before = buildOverviewRows(dbRows);
  assert.equal(before.rows[0].abnormal, true);
  assert.equal(before.summary.absurdYoy, 1);

  const after = buildOverviewRows(dbRows, { ackedAnnouncementIds: ['ann-tianqi-q3'] });
  assert.equal(after.rows[0].acked, true);
  assert.equal(after.rows[0].abnormal, false);
  assert.equal(after.summary.abnormal, 0);
  assert.equal(after.summary.absurdYoy, 0);
});

test('flagged normal row enters abnormal summary and filter', () => {
  const dbRows: OverviewDbMetric[] = [
    {
      code: '000001', name: '平安银行', announcement_id: 'ann-pab-q3',
      period: '2026Q3', metric: 'revenue',
      value: 1e11, unit: '元', source_page: 1, prior_value: null, yoy_pct: 3.8,
    },
    {
      code: '000001', name: '平安银行', announcement_id: 'ann-pab-q3',
      period: '2026Q3', metric: 'net_profit',
      value: 1e10, unit: '元', source_page: 1, prior_value: null, yoy_pct: 2,
    },
    {
      code: '000001', name: '平安银行', announcement_id: 'ann-pab-q3',
      period: '2026Q3', metric: 'eps',
      value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 2,
    },
    {
      code: '000001', name: '平安银行', announcement_id: 'ann-pab-q3',
      period: '2026Q3', metric: 'roe',
      value: 10, unit: '%', source_page: 1, prior_value: null, yoy_pct: 1,
    },
  ];
  const before = buildOverviewRows(dbRows);
  assert.equal(before.rows[0].abnormal, false);
  assert.equal(before.summary.abnormal, 0);

  const flagged = buildOverviewRows(dbRows, {
    reviews: [{ announcementId: 'ann-pab-q3', status: 'flagged', note: '用户反馈净利' }],
  });
  assert.equal(flagged.rows[0].flagged, true);
  assert.equal(flagged.rows[0].acked, false);
  assert.equal(flagged.rows[0].abnormal, true);
  assert.equal(flagged.rows[0].reviewNote, '用户反馈净利');
  assert.equal(flagged.summary.abnormal, 1);
});

test('acked and flagged are mutual exclusive in overview rows', () => {
  const dbRows: OverviewDbMetric[] = [
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'revenue',
      value: 1e9, unit: '元', source_page: 1, prior_value: null, yoy_pct: 10,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'net_profit',
      value: 1e8, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1324,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'eps',
      value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 10,
    },
    {
      code: '002466', name: '天齐锂业', announcement_id: 'ann-tianqi-q3',
      period: '2026Q3', metric: 'roe',
      value: 5, unit: '%', source_page: 1, prior_value: null, yoy_pct: 10,
    },
  ];
  const acked = buildOverviewRows(dbRows, {
    reviews: [{ announcementId: 'ann-tianqi-q3', status: 'acked' }],
  });
  assert.equal(acked.rows[0].acked, true);
  assert.equal(acked.rows[0].flagged, false);
  assert.equal(acked.rows[0].abnormal, false);

  const reflag = buildOverviewRows(dbRows, {
    reviews: [{ announcementId: 'ann-tianqi-q3', status: 'flagged', note: '再发现错' }],
  });
  assert.equal(reflag.rows[0].flagged, true);
  assert.equal(reflag.rows[0].acked, false);
  assert.equal(reflag.rows[0].abnormal, true);
});

test('buildOverviewRows carries audit opinion and summary buckets', () => {
  const rows: OverviewDbMetric[] = [
    {
      code: '600000', name: '浦发银行', period: '2025FY', metric: 'revenue',
      announcement_id: 'a1', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
      audit_opinion_kind: 'non_standard', audit_opinion_label: '保留意见', audit_opinion_page: 120,
    },
    {
      code: '600000', name: '浦发银行', period: '2025FY', metric: 'net_profit',
      announcement_id: 'a1', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
      audit_opinion_kind: 'non_standard', audit_opinion_label: '保留意见', audit_opinion_page: 120,
    },
    {
      code: '600000', name: '浦发银行', period: '2025FY', metric: 'eps',
      announcement_id: 'a1', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
    },
    {
      code: '600000', name: '浦发银行', period: '2025FY', metric: 'roe',
      announcement_id: 'a1', value: 1, unit: '%', source_page: 1, prior_value: null, yoy_pct: 1,
    },
    {
      code: '000001', name: '平安银行', period: '2025Q3', metric: 'revenue',
      announcement_id: 'a2', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
      audit_opinion_kind: 'none', audit_opinion_label: '本期未见审计意见', audit_opinion_page: null,
    },
    {
      code: '000001', name: '平安银行', period: '2025Q3', metric: 'net_profit',
      announcement_id: 'a2', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
    },
    {
      code: '000001', name: '平安银行', period: '2025Q3', metric: 'eps',
      announcement_id: 'a2', value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 1,
    },
    {
      code: '000001', name: '平安银行', period: '2025Q3', metric: 'roe',
      announcement_id: 'a2', value: 1, unit: '%', source_page: 1, prior_value: null, yoy_pct: 1,
    },
  ];
  const { rows: out, summary } = buildOverviewRows(rows);
  assert.equal(out.length, 2);
  const nonStd = out.find((r) => r.code === '600000');
  assert.equal(nonStd?.auditOpinionKind, 'non_standard');
  assert.equal(nonStd?.auditOpinionLabel, '保留意见');
  assert.equal(nonStd?.auditOpinionPage, 120);
  assert.equal(summary.auditNonStandard, 1);
  assert.equal(summary.auditNone, 1);
  assert.equal(summary.auditStandard, 0);
});


test('buildOverviewRows flags period_mismatch and deep-links by title period', () => {
  const { rows, summary } = buildOverviewRows([
    {
      code: '300760',
      name: '迈瑞医疗',
      title: '迈瑞医疗：2026年一季度报告',
      announcement_id: 'ann-mindray-q1',
      period: '2026FY',
      metric: 'revenue',
      value: 1e10, unit: '元', source_page: 1, prior_value: null, yoy_pct: 5,
    },
    {
      code: '300760', name: '迈瑞医疗', announcement_id: 'ann-mindray-q1',
      period: '2026FY', metric: 'net_profit',
      value: 1e9, unit: '元', source_page: 1, prior_value: null, yoy_pct: 5,
    },
    {
      code: '300760', name: '迈瑞医疗', announcement_id: 'ann-mindray-q1',
      period: '2026FY', metric: 'eps',
      value: 1, unit: '元', source_page: 1, prior_value: null, yoy_pct: 5,
    },
    {
      code: '300760', name: '迈瑞医疗', announcement_id: 'ann-mindray-q1',
      period: '2026FY', metric: 'roe',
      value: 5, unit: '%', source_page: 1, prior_value: null, yoy_pct: 5,
    },
  ]);
  assert.equal(rows[0].period, '2026FY');
  assert.ok(rows[0].issues.includes('period_mismatch'));
  assert.equal(rows[0].abnormal, true);
  assert.equal(rows[0].href, '/300760?period=2026Q1');
  assert.ok(summary.abnormal >= 1);
});
