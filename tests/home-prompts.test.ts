import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextualHomePrompts,
  mergeHomePromptLists,
  parseHomePromptQuestions,
  prependPersonalizedPlaceholders,
} from '../lib/home-prompts-shared';

test('parseHomePromptQuestions keeps 4 themed lines and drops canned 营业收入', () => {
  const raw = [
    '1. 宁德时代毛利率和上年同期比如何？',
    '2. 本期营业收入是多少？',
    '3. 对比比亚迪和宁德时代的毛利率',
    '4. 亿纬锂能毛利率变化的主要原因？',
    '5. 赣锋锂业盈利质量怎么样？',
  ].join('\n');
  const parsed = parseHomePromptQuestions(raw, ['宁德时代毛利率最近怎么变？']);
  assert.equal(parsed.length, 4);
  assert.ok(!parsed.some((q) => q.includes('营业收入是多少')));
  assert.equal(parsed[0], '宁德时代毛利率和上年同期比如何？');
});

test('contextualHomePrompts prefers same-industry peers', () => {
  const questions = contextualHomePrompts({
    question: '宁德时代毛利率最近怎么变？',
    companyName: '宁德时代',
    companyCode: '300750',
    industryGroup: '新能源',
    peers: [
      { code: '002594', name: '比亚迪' },
      { code: '300014', name: '亿纬锂能' },
    ],
  });
  assert.ok(questions.length >= 3);
  const blob = questions.join('\n');
  assert.match(blob, /毛利率/);
  assert.match(blob, /比亚迪|亿纬锂能|同行/);
});

test('prependPersonalizedPlaceholders puts custom questions first and dedupes', () => {
  const merged = prependPersonalizedPlaceholders(
    ['宁德时代毛利率和上年同期比如何？', '对比比亚迪和宁德时代的毛利率'],
    ['宁德时代毛利率和上年同期比如何？', '招商银行经营现金流是否健康？', '五粮液毛利率最近怎么变？'],
  );
  assert.equal(merged[0], '宁德时代毛利率和上年同期比如何？');
  assert.equal(merged[1], '对比比亚迪和宁德时代的毛利率');
  assert.equal(merged.filter((q) => q.includes('宁德时代毛利率和上年同期')).length, 1);
  assert.ok(merged.includes('招商银行经营现金流是否健康？'));
});

test('mergeHomePromptLists fills from fallback without repeating the source ask', () => {
  const merged = mergeHomePromptLists(
    ['比亚迪毛利率同比怎么样？'],
    contextualHomePrompts({
      question: '宁德时代毛利率最近怎么变？',
      companyName: '宁德时代',
      companyCode: '300750',
      industryGroup: '新能源',
      peers: [{ code: '002594', name: '比亚迪' }],
    }),
    ['宁德时代毛利率最近怎么变？'],
  );
  assert.ok(merged.length >= 3);
  assert.equal(merged[0], '比亚迪毛利率同比怎么样？');
  assert.ok(!merged.some((q) => q === '宁德时代毛利率最近怎么变？'));
});
