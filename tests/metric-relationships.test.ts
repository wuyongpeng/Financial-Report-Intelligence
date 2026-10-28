import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetricRelationships,
  containsInvestmentAdvice,
} from '../lib/metric-relationships';
import type { MetricName, Report } from '../lib/detail-model';

function metric(
  name: MetricName,
  value: number,
  page = 6,
  extra: Partial<{ prior_value: number; yoy_pct: number }> = {},
) {
  return {
    metric: name,
    value,
    unit: '元',
    source_page: page,
    source_label: name,
    confidence: 0.9,
    verified: 0,
    period: '2026FY',
    ...extra,
  };
}

function build(period: string, extra: ReturnType<typeof metric>[] = []): Report {
  return {
    id: period,
    code: '600000',
    company_name: '示例',
    title: period,
    report_type: 'annual',
    published_at: `${period.slice(0, 4)}-04-01`,
    parsed_at: '2026-01-01',
    industry: '银行',
    status: 'online',
    metrics: extra.map((m) => ({ ...m, period })),
  };
}

test('数字关系：无信号时返回空数组（UI 应整块隐藏）', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10, 5, { yoy_pct: 10 }),
    metric('net_profit', 1e9, 10, { yoy_pct: 8 }),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  assert.equal(cards.length, 0);
});

test('数字关系：营收同比↑净利同比↓命中，双出处 + 无投资建议', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { yoy_pct: 12.3 }),
    metric('net_profit', 8e8, 10, { yoy_pct: -15.0 }),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  const card = cards.find((c) => c.id === 'revenue_vs_profit_yoy');
  assert.ok(card);
  assert.match(card!.phenomenon, /背离|同比/);
  assert.equal(card!.numbers.length, 2);
  assert.ok(card!.cites.some((c) => c.page === 5));
  assert.ok(card!.cites.some((c) => c.page === 10));
  assert.ok(card!.askPrompt.includes('第 5 页') || card!.askPrompt.includes('出处'));
  assert.equal(containsInvestmentAdvice(card!.phenomenon), false);
  assert.equal(containsInvestmentAdvice(card!.askPrompt), false);
  assert.ok(!/建议减持|买入|卖出|投资建议/.test(card!.phenomenon + card!.askPrompt));
});

test('数字关系：两边同比同向不命中', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10, 5, { yoy_pct: -5 }),
    metric('net_profit', 8e8, 10, { yoy_pct: -8 }),
  ]);
  const cards = buildMetricRelationships(selected);
  assert.equal(cards.find((c) => c.id === 'revenue_vs_profit_yoy'), undefined);
});

test('数字关系：缺同比数据时不臆造营收净利背离', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 8e8, 10),
  ]);
  const cards = buildMetricRelationships(selected, { previous: null });
  assert.equal(cards.find((c) => c.id === 'revenue_vs_profit_yoy'), undefined);
});

test('数字关系：净现比偏低命中', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10, 5, { yoy_pct: 5 }),
    metric('net_profit', 1e9, 10, { yoy_pct: 5 }),
    metric('operating_cash_flow', 3e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  const card = cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.phenomenon, /净现比|经营现金流/);
  assert.ok(card!.cites.some((c) => c.metric === 'net_profit' || c.page === 10));
  assert.ok(card!.cites.some((c) => c.metric === 'operating_cash_flow' || c.page === 20));
  assert.equal(containsInvestmentAdvice(card!.phenomenon), false);
});

test('数字关系：净利为正且经营现金流为负命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', -2e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  const card = cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.phenomenon, /为正|为负|经营现金流/);
});

test('数字关系：净现比充足不命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 8e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  assert.equal(cards.find((c) => c.id === 'cash_vs_profit'), undefined);
});

test('数字关系：缺经营现金流不足以出卡', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
  ]);
  const cards = buildMetricRelationships(selected);
  assert.equal(cards.find((c) => c.id === 'cash_vs_profit'), undefined);
});

test('数字关系：最多 2 张', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { yoy_pct: 12 }),
    metric('net_profit', 8e8, 10, { yoy_pct: -10 }),
    metric('operating_cash_flow', -1e8, 20),
  ]);
  const cards = buildMetricRelationships(selected);
  assert.ok(cards.length <= 2);
  assert.ok(cards.length === 2);
  assert.deepEqual(
    cards.map((c) => c.id).sort(),
    ['cash_vs_profit', 'revenue_vs_profit_yoy'],
  );
});

test('数字关系：可用跨期基准计算同比背离', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5),
    metric('net_profit', 5e8, 10),
  ]);
  const previous = build('2025FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 8e8, 10),
  ]);
  const cards = buildMetricRelationships(selected, {
    previous,
    preferDisclosedYoy: false,
  });
  const card = cards.find((c) => c.id === 'revenue_vs_profit_yoy');
  assert.ok(card);
  assert.match(card!.phenomenon, /背离/);
});
