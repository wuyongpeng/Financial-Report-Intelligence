import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisclosureFlags, DISCLOSURE_FLAG_RULE_STATUS } from '../lib/disclosure-flags';
import type { Report } from '../lib/detail-model';

function metric(name: string, value: number, page = 6) {
  return {
    metric: name as never,
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

test('披露排雷：净利同比大幅下行命中 live 规则', () => {
  const selected = build('2026FY', [metric('revenue', 1e10), metric('net_profit', 4e8)]);
  const flags = buildDisclosureFlags({
    selected,
    yoyMoves: [{ metric: 'net_profit', pct: -40, label: '下降40%' }],
  });
  assert.ok(flags.some((f) => f.id === 'sharp-drop-net_profit'));
  assert.equal(flags.find((f) => f.id === 'sharp-drop-net_profit')?.status, 'live');
  assert.match(flags[0].phenomenon, /2026FY/);
  assert.ok(flags[0].why.length > 0);
  assert.ok(flags[0].where.length > 0);
});

test('披露排雷：现金流弱于利润 + 高杠杆可同时命中', () => {
  const selected = build('2026FY', [
    metric('revenue', 1e10),
    metric('net_profit', 1e9),
    metric('operating_cash_flow', 5e8),
    metric('total_assets', 1e11),
    metric('total_liabilities', 8e10),
  ]);
  const flags = buildDisclosureFlags({ selected });
  const ids = flags.map((f) => f.id);
  assert.ok(ids.includes('cash-vs-profit'));
  assert.ok(ids.includes('high-leverage'));
});

test('披露排雷：毛利率压缩相对对比期命中', () => {
  const previous = build('2025FY', [
    metric('revenue', 1e10),
    metric('operating_cost', 4e9),
  ]);
  const selected = build('2026FY', [
    metric('revenue', 1e10),
    metric('operating_cost', 5e9),
  ]);
  const flags = buildDisclosureFlags({ selected, previous });
  assert.ok(flags.some((f) => f.id === 'margin-compression'));
});

test('披露排雷：健康样本零命中', () => {
  const previous = build('2025FY', [
    metric('revenue', 1e10),
    metric('net_profit', 2e9),
    metric('operating_cost', 4e9),
    metric('operating_cash_flow', 2.2e9),
    metric('total_assets', 1e11),
    metric('total_liabilities', 3e10),
  ]);
  const selected = build('2026FY', [
    metric('revenue', 1.1e10),
    metric('net_profit', 2.2e9),
    metric('operating_cost', 4.2e9),
    metric('operating_cash_flow', 2.4e9),
    metric('total_assets', 1.1e11),
    metric('total_liabilities', 3.2e10),
  ]);
  const flags = buildDisclosureFlags({
    selected,
    previous,
    yoyMoves: [
      { metric: 'revenue', pct: 10 },
      { metric: 'net_profit', pct: 10 },
    ],
  });
  assert.deepEqual(flags, []);
});

test('披露排雷规则清单含 live 与 todo', () => {
  assert.ok(DISCLOSURE_FLAG_RULE_STATUS.live.length >= 2);
  assert.ok(DISCLOSURE_FLAG_RULE_STATUS.todo.length >= 1);
});
