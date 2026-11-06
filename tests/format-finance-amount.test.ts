import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFinanceAmount, formatMetricFinanceAmount, humanizeYuanInText } from '../lib/format-finance-amount';

test('large 元 amounts render as 亿元 for humans', () => {
  assert.equal(formatFinanceAmount(32483000000, '元'), '324.83亿元');
  assert.equal(formatFinanceAmount(90703260964.48, '元'), '907.03亿元');
  assert.equal(formatFinanceAmount(100, '元'), '100元');
  assert.equal(formatFinanceAmount(12.5, '元/股'), '12.5元/股');
  assert.equal(formatFinanceAmount(15.2, '%'), '15.2%');
  assert.equal(formatFinanceAmount(-1_234_000_000, '元'), '-12.34亿元');
  assert.equal(formatMetricFinanceAmount('revenue', 32483000000), '324.83亿元');
  assert.equal(formatMetricFinanceAmount('eps', 1.25), '1.25元/股');
});

test('humanizeYuanInText rewrites long raw 元 for TTS', () => {
  assert.match(humanizeYuanInText('平安银行营业收入：32483000000元【E1】'), /324\.83亿元/);
  assert.equal(humanizeYuanInText('营收约100元'), '营收约100元');
  assert.match(humanizeYuanInText('金额 32,483,000,000 元'), /324\.83亿元/);
});
