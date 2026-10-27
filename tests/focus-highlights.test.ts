import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusHighlights, scanUnitAnomalies } from '../lib/focus-highlights';
import type { MetricName, Report } from '../lib/detail-model';

function metric(name: MetricName, value: number, page = 6) {
  return {
    metric: name,
    value,
    unit: '元',
    source_page: page,
    source_label: name,
    confidence: 0.9,
    verified: 0,
    period: '2026FY',
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

const BANNED = /异常|疑似/;

test('重点关注：无信号时恰好 2 张默认卡', () => {
  const cards = buildFocusHighlights(build('2026FY', [
    metric('net_profit', 1e9),
    metric('operating_cash_flow', 8e8),
    metric('non_recurring_pnl', 1e7),
    metric('profit_ex_non_recurring', 9.9e8),
    metric('total_assets', 1e11),
    metric('cash_and_equivalents', 1e9),
    metric('short_term_borrowings', 1e8),
  ]));
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((c) => c.id), ['earnings_quality_scan', 'balance_sheet_scan']);
  assert.ok(cards.every((c) => c.status === 'none'));
  assert.ok(cards.every((c) => /暂无风险|未发现/.test(c.conclusion)));
});

test('重点关注：最多返回 2 张信号卡', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', -1e8, 20),
    metric('non_recurring_pnl', 5e8, 11),
    metric('profit_ex_non_recurring', -1e8, 11),
    metric('total_assets', 1e11),
    metric('cash_and_equivalents', 3e10),
    metric('short_term_borrowings', 2.5e10),
  ]);
  const cards = buildFocusHighlights(selected);
  assert.ok(cards.length <= 2);
  assert.ok(cards.every((c) => c.status === 'signal'));
});

test('重点关注：净现比偏低命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 3e8, 20),
  ]);
  const cards = buildFocusHighlights(selected);
  const card = cards.find((c) => c.id === 'cash_vs_profit');
  assert.ok(card);
  assert.equal(card!.status, 'signal');
  assert.match(card!.conclusion, /净现比 0\.3/);
  assert.ok(!BANNED.test(card!.conclusion));
});

test('重点关注：非经常性损益占比命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9),
    metric('non_recurring_pnl', 3e8),
    metric('profit_ex_non_recurring', 7e8),
  ]);
  const cards = buildFocusHighlights(selected);
  const card = cards.find((c) => c.id === 'non_recurring' || c.id === 'one_off_boost');
  assert.ok(card);
  assert.equal(card!.status, 'signal');
});

test('重点关注：存贷双高命中并附受限', () => {
  const selected = build('2026FY', [
    metric('total_assets', 1e11),
    metric('cash_and_equivalents', 3e10),
    metric('short_term_borrowings', 1e10),
    metric('long_term_borrowings', 1e10),
    metric('bonds_payable', 5e9),
    metric('current_portion_debt', 0),
    metric('restricted_cash', 2e9),
  ]);
  const cards = buildFocusHighlights(selected);
  const card = cards.find((c) => c.id === 'cash_and_debt');
  assert.ok(card);
  assert.equal(card!.status, 'signal');
  assert.match(card!.conclusion, /货币资金 300\.00 亿元/);
  assert.match(card!.conclusion, /有息负债 250\.00 亿元/);
});

test('重点关注：星宇式外包万元单位异常命中', () => {
  const selected = build('2024FY', [
    metric('revenue', 1.33e10, 5), // ~133 亿
  ]);
  const pages = [
    {
      page: 118,
      content:
        '公司支付的劳务外包报酬共计 243,526,388.49万元，主要用于生产线辅助人员。',
    },
  ];
  const cards = buildFocusHighlights(selected, { pages });
  assert.equal(cards[0]?.id, 'unit_anomaly');
  assert.equal(cards[0]?.status, 'signal');
  assert.match(cards[0]!.conclusion, /243/);
  assert.equal(cards[0]!.cites[0]?.page, 118);
});

test('scanUnitAnomalies：无荒诞数字不命中', () => {
  const card = scanUnitAnomalies(
    [{ page: 10, content: '销售费用 1,234.56万元，同比下降。' }],
    1e10,
  );
  assert.equal(card.status, 'none');
});

test('重点关注：结论不含禁用词', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9),
    metric('operating_cash_flow', -1e8),
    metric('non_recurring_pnl', 5e8),
    metric('profit_ex_non_recurring', -1e8),
    metric('total_assets', 1e11),
    metric('cash_and_equivalents', 3e10),
    metric('short_term_borrowings', 2.5e10),
  ]);
  for (const card of buildFocusHighlights(selected)) {
    assert.ok(!BANNED.test(card.conclusion), card.conclusion);
  }
});
