import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HOME_PLACEHOLDERS,
  FALLBACK_PLACEHOLDER_SEEDS,
  PLACEHOLDER_SCENE_IDS,
  buildHomePlaceholders,
  periodAskLabel,
  shortCompanyName,
  type PlaceholderSeed,
} from '../lib/home-placeholders';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('periodAskLabel maps canonical tokens', () => {
  assert.equal(periodAskLabel('2026H1'), '2026半年报');
  assert.equal(periodAskLabel('2025FY'), '2025年报');
  assert.equal(periodAskLabel('2026Q1'), '2026一季报');
  assert.equal(periodAskLabel(''), '');
});

test('shortCompanyName strips legal suffix', () => {
  assert.equal(shortCompanyName('贵州茅台酒股份有限公司'), '贵州茅台酒');
  assert.equal(shortCompanyName('招商银行'), '招商银行');
});

test('default placeholders are 15 mixed scenes and do not start with 茅台', () => {
  assert.equal(DEFAULT_HOME_PLACEHOLDERS.length, 15);
  assert.equal(PLACEHOLDER_SCENE_IDS.length, 15);
  assert.equal(new Set(DEFAULT_HOME_PLACEHOLDERS).size, 15);
  assert.doesNotMatch(DEFAULT_HOME_PLACEHOLDERS[0] ?? '', /茅台/);
  assert.match(DEFAULT_HOME_PLACEHOLDERS.join('\n'), /对比.+ROE|ROE和同行/);
});

test('buildHomePlaceholders uses live companies and stays at 15', () => {
  const companies: PlaceholderSeed[] = [
    { code: '688256', name: '寒武纪', industryGroup: '科技', reportPeriod: '2026H1', hasReadableMetrics: true },
    { code: '688008', name: '澜起科技', industryGroup: '科技', reportPeriod: '2026Q1', hasReadableMetrics: true },
    { code: '600519', name: '贵州茅台', industryGroup: '消费', reportPeriod: '2026H1', hasReadableMetrics: true },
    { code: '000858', name: '五粮液', industryGroup: '消费', reportPeriod: '2025FY', hasReadableMetrics: true },
    { code: '600036', name: '招商银行', industryGroup: '金融', reportPeriod: '2026H1', hasReadableMetrics: true },
  ];
  const questions = buildHomePlaceholders(companies, { random: seeded(7) });
  assert.equal(questions.length, 15);
  assert.equal(new Set(questions).size, 15);
  const blob = questions.join('\n');
  assert.match(blob, /寒武纪|澜起科技|贵州茅台|五粮液|招商银行/);
  assert.match(blob, /增长是否缓慢|净利润同比|毛利率|经营现金流|资产负债率|异常指标|盈利质量|值不值得关注/);
});

test('empty coverage falls back to seeded names', () => {
  const questions = buildHomePlaceholders([], { random: seeded(3) });
  assert.equal(questions.length, 15);
  const blob = questions.join('\n');
  assert.ok(FALLBACK_PLACEHOLDER_SEEDS.some((s) => blob.includes(s.name)));
});

test('two rng seeds produce different first questions', () => {
  const companies: PlaceholderSeed[] = FALLBACK_PLACEHOLDER_SEEDS.map((s) => ({ ...s, hasReadableMetrics: true }));
  const a = buildHomePlaceholders(companies, { random: seeded(11) });
  const b = buildHomePlaceholders(companies, { random: seeded(99) });
  assert.notEqual(a[0], b[0]);
});
