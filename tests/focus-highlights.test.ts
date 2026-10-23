import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFocusHighlights } from '../lib/focus-highlights';
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

const BANNED = /风险|异常|疑似/;

test('重点关注：永远返回恰好 4 张卡且顺序固定', () => {
  const cards = buildFocusHighlights(build('2026FY'));
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.id), [
    'non_recurring',
    'cash_vs_profit',
    'cash_and_debt',
    'other',
  ]);
  assert.deepEqual(cards.map((c) => c.title), [
    '非经常性损益',
    '利润与经营现金流',
    '存贷情况',
    '其它关注',
  ]);
});

test('重点关注：卡2 净现比偏低命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9, 10),
    metric('operating_cash_flow', 3e8, 20),
  ]);
  const card = buildFocusHighlights(selected).find((c) => c.id === 'cash_vs_profit')!;
  assert.equal(card.status, 'signal');
  assert.match(card.conclusion, /净现比 0\.3/);
  assert.equal(card.cites.length, 2);
  assert.ok(!BANNED.test(card.conclusion));
});

test('重点关注：卡2 健康样本无信号', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9),
    metric('operating_cash_flow', 8e8),
  ]);
  const card = buildFocusHighlights(selected).find((c) => c.id === 'cash_vs_profit')!;
  assert.equal(card.status, 'none');
  assert.equal(card.conclusion, '未发现需要关注的情况');
});

test('重点关注：卡2 缺字段为数据不足', () => {
  const selected = build('2026FY', [metric('net_profit', 1e9)]);
  const card = buildFocusHighlights(selected).find((c) => c.id === 'cash_vs_profit')!;
  assert.equal(card.status, 'insufficient');
  assert.equal(card.conclusion, '财报未披露相关数据，暂无法判断');
});

test('重点关注：卡1 非经常性损益占比命中', () => {
  const selected = build('2026FY', [
    metric('net_profit', 1e9),
    metric('non_recurring_pnl', 3e8),
    metric('profit_ex_non_recurring', 7e8),
  ]);
  const card = buildFocusHighlights(selected).find((c) => c.id === 'non_recurring')!;
  assert.equal(card.status, 'signal');
  assert.match(card.conclusion, /非经常性损益 3\.00 亿元/);
  assert.match(card.conclusion, /占归母净利润 30\.0%/);
});

test('重点关注：卡3 存贷双高命中并附受限', () => {
  const selected = build('2026FY', [
    metric('total_assets', 1e11),
    metric('cash_and_equivalents', 3e10),
    metric('short_term_borrowings', 1e10),
    metric('long_term_borrowings', 1e10),
    metric('bonds_payable', 5e9),
    metric('current_portion_debt', 0),
    metric('restricted_cash', 2e9),
  ]);
  const card = buildFocusHighlights(selected).find((c) => c.id === 'cash_and_debt')!;
  assert.equal(card.status, 'signal');
  assert.match(card.conclusion, /货币资金 300\.00 亿元/);
  assert.match(card.conclusion, /有息负债 250\.00 亿元/);
  assert.match(card.conclusion, /其中受限 20\.00 亿元/);
});

test('重点关注：卡4 无结构化字段时写无', () => {
  const card = buildFocusHighlights(build('2026FY')).find((c) => c.id === 'other')!;
  assert.equal(card.status, 'none');
  assert.equal(card.conclusion, '无');
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
