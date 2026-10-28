import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetricRelationships,
  containsInvestmentAdvice,
  METRIC_REL_EMPTY,
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

function allText(card: {
  title: string;
  facts: string[];
  howToRead: string;
  reasonBoundary: string;
  askPrompt: string;
}) {
  return [card.title, ...card.facts, card.howToRead, card.reasonBoundary, card.askPrompt].join('\n');
}

test('关键关系：营收↑净利↓出卡，含两期事实、归母净利率、怎么看/原因边界', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { prior_value: 1e10, yoy_pct: 20 }),
    metric('net_profit', 8e8, 10, { prior_value: 1e9, yoy_pct: -20 }),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const result = buildMetricRelationships(selected);
  assert.equal(result.status, 'has_cards');
  const card = result.cards.find((c) => c.id === 'revenue_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /没有转化为利润|增长/);
  assert.ok(card!.facts.some((f) => /营收由|归母净利润由/.test(f)));
  assert.ok(card!.facts.some((f) => /归母净利率/.test(f) && !/毛利率为/.test(f)));
  assert.match(card!.howToRead, /每单位收入|利润/);
  assert.match(card!.reasonBoundary, /原因待核验|核对原文/);
  assert.equal(card!.tone, 'watch');
  assert.ok(card!.cites.some((c) => c.page === 5));
  assert.ok(card!.cites.some((c) => c.page === 10));
  assert.equal(containsInvestmentAdvice(allText(card!)), false);
});

test('关键关系：收入与利润同步增长（理解向，非警报）', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { yoy_pct: 12 }),
    metric('net_profit', 1.1e9, 10, { yoy_pct: 10 }),
    metric('operating_cash_flow', 1e9, 20),
  ]);
  const previous = build('2025FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const result = buildMetricRelationships(selected, {
    previous,
    preferDisclosedYoy: true,
  });
  const card = result.cards.find((c) => c.id === 'revenue_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /同步增长/);
  assert.equal(card!.tone, 'ok');
});

test('关键关系：两边同比同向但增幅不足 → 不就营收净利出卡', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.02e10, 5, { yoy_pct: 2 }),
    metric('net_profit', 1.01e9, 10, { yoy_pct: 1 }),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const result = buildMetricRelationships(selected);
  assert.equal(result.cards.find((c) => c.id === 'revenue_vs_profit'), undefined);
});

test('关键关系：缺同比时营收净利 insufficient，不臆造', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 8e8, 10),
  ]);
  const result = buildMetricRelationships(selected, { previous: null });
  assert.equal(result.cards.find((c) => c.id === 'revenue_vs_profit'), undefined);
});

test('关键关系：利润↑现金流↓跨期分化', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 3e8, 20),
  ]);
  const previous = build('2025FY', [
    metric('net_profit', 8e8, 10),
    metric('operating_cash_flow', 1.2e9, 20),
  ]);
  const result = buildMetricRelationships(selected, { previous });
  const card = result.cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /分化|走弱|为负/);
  assert.ok(card!.facts.some((f) => /由/.test(f) && /经营现金流/.test(f)));
  assert.ok(card!.facts.some((f) => /比值|%/.test(f)));
  assert.match(card!.reasonBoundary, /不能据此|原因待核验/);
  assert.equal(card!.tone, 'watch');
});

test('关键关系：利润与现金流同步改善', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1.2e9, 10),
    metric('operating_cash_flow', 1.5e9, 20),
  ]);
  const previous = build('2025FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 1.1e9, 20),
  ]);
  const result = buildMetricRelationships(selected, { previous });
  const card = result.cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /伴随|改善/);
  assert.equal(card!.tone, 'ok');
});

test('关键关系：无上期时净现比偏低仍可出卡', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 3e8, 20),
  ]);
  const result = buildMetricRelationships(selected, { previous: null });
  const card = result.cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /偏弱|为负/);
});

test('关键关系：净利为正经营现金流为负', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', -2e8, 20),
  ]);
  const result = buildMetricRelationships(selected);
  const card = result.cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /为负|分化/);
});

test('关键关系：扣非占比高命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('profit_ex_non_recurring', 6e8, 11),
    metric('non_recurring_pnl', 4e8, 12),
  ]);
  const result = buildMetricRelationships(selected);
  const card = result.cards.find((c) => c.id === 'profit_vs_ex_non_recurring');
  assert.ok(card);
  assert.match(card!.title, /非经常性|扣非/);
  assert.ok(card!.facts.some((f) => /扣非|非经常性/.test(f)));
  assert.match(card!.reasonBoundary, /原因待核验/);
});

test('关键关系：扣非后为负命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 2e8, 10),
    metric('profit_ex_non_recurring', -1e8, 11),
    metric('non_recurring_pnl', 3e8, 12),
  ]);
  const result = buildMetricRelationships(selected);
  const card = result.cards.find((c) => c.id === 'profit_vs_ex_non_recurring');
  assert.ok(card);
  assert.match(card!.title, /扣非后/);
});

test('关键关系：扣非占比低不命中该类型', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('profit_ex_non_recurring', 9.5e8, 11),
    metric('non_recurring_pnl', 5e7, 12),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const result = buildMetricRelationships(selected);
  assert.equal(result.cards.find((c) => c.id === 'profit_vs_ex_non_recurring'), undefined);
});

test('关键关系：缺扣非字段 → 该类型 insufficient，不臆造', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
  ]);
  const result = buildMetricRelationships(selected);
  assert.equal(result.cards.find((c) => c.id === 'profit_vs_ex_non_recurring'), undefined);
});

test('关键关系：已检查无明显背离 → checked_none 文案', () => {
  // 同比同向微增 + 净现比充足 + 无扣非 → 可检查但无卡
  const selected = build('2026FY', [
    metric('revenue', 1.02e10, 5, { yoy_pct: 2 }),
    metric('net_profit', 1.01e9, 10, { yoy_pct: 1 }),
    metric('operating_cash_flow', 9e8, 20),
    metric('profit_ex_non_recurring', 9.8e8, 11),
    metric('non_recurring_pnl', 2e7, 12),
  ]);
  const previous = build('2025FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 8.5e8, 20),
  ]);
  // cash: profit up slightly, ocf up → bothUp would fire!
  // Use flat-ish cash that doesn't bothUp or diverge: profit 1.01e9 vs 1e9 up, ocf 9e8 vs 9e8 flat
  const previous2 = build('2025FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 9e8, 20),
  ]);
  const result = buildMetricRelationships(selected, { previous: previous2 });
  // revenue sync too weak; cash: profit up ocf flat → not crossDiverge, not bothUp;
  // ratio 0.9/1.01≈0.89 vs prior 0.9 — no collapse; non-recurring low
  assert.equal(result.cards.length, 0);
  assert.equal(result.status, 'checked_none');
  assert.equal(METRIC_REL_EMPTY.checked_none, '已检查的关系未发现明显背离');
  assert.ok(!/暂无风险/.test(METRIC_REL_EMPTY.checked_none));
});

test('关键关系：三类均缺数据 → insufficient', () => {
  const selected = build('2026FY', [
    metric('roe', 12, 3),
  ]);
  const result = buildMetricRelationships(selected);
  assert.equal(result.cards.length, 0);
  assert.equal(result.status, 'insufficient');
  assert.equal(METRIC_REL_EMPTY.insufficient, '缺少可比数据，暂无法判断');
});

test('关键关系：最多 3 张', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { prior_value: 1e10, yoy_pct: 20 }),
    metric('net_profit', 8e8, 10, { prior_value: 1e9, yoy_pct: -20 }),
    metric('operating_cash_flow', -1e8, 20),
    metric('profit_ex_non_recurring', 2e8, 11),
    metric('non_recurring_pnl', 6e8, 12),
  ]);
  const previous = build('2025FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 8e8, 20),
  ]);
  const result = buildMetricRelationships(selected, { previous });
  assert.ok(result.cards.length <= 3);
  assert.ok(result.cards.length >= 2);
  const ids = new Set(result.cards.map((c) => c.id));
  assert.ok(ids.has('revenue_vs_profit'));
  assert.ok(ids.has('cash_vs_profit'));
  assert.ok(ids.has('profit_vs_ex_non_recurring'));
});

test('关键关系：跨期基准可算营收净利背离', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5),
    metric('net_profit', 5e8, 10),
  ]);
  const previous = build('2025FY', [
    metric('revenue', 1e10, 5),
    metric('net_profit', 8e8, 10),
  ]);
  const result = buildMetricRelationships(selected, {
    previous,
    preferDisclosedYoy: false,
  });
  const card = result.cards.find((c) => c.id === 'revenue_vs_profit');
  assert.ok(card);
  assert.match(card!.title, /没有转化为|增长/);
});

test('关键关系：文案不含投资建议禁用词', () => {
  const selected = build('2026FY', [
    metric('revenue', 1.2e10, 5, { yoy_pct: 12 }),
    metric('net_profit', 8e8, 10, { yoy_pct: -15 }),
    metric('operating_cash_flow', -1e8, 20),
    metric('profit_ex_non_recurring', 3e8, 11),
    metric('non_recurring_pnl', 5e8, 12),
  ]);
  const result = buildMetricRelationships(selected);
  for (const card of result.cards) {
    assert.equal(containsInvestmentAdvice(allText(card)), false);
    assert.ok(!/建议减持|买入|卖出|投资建议|暂无风险/.test(allText(card)));
  }
});
