import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFinanceAmount } from '../lib/format-finance-amount';

test('large 元 amounts render as 亿元 for humans', () => {
  assert.equal(formatFinanceAmount(32483000000, '元'), '324.83亿元');
  assert.equal(formatFinanceAmount(90703260964.48, '元'), '907.03亿元');
  assert.equal(formatFinanceAmount(100, '元'), '100元');
  assert.equal(formatFinanceAmount(12.5, '元/股'), '12.5元/股');
  assert.equal(formatFinanceAmount(15.2, '%'), '15.2%');
  assert.equal(formatFinanceAmount(-1_234_000_000, '元'), '-12.34亿元');
});
