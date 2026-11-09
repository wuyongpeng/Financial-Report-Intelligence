import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ASK_STOPPED_LINE, dropBlankInFlightTurn, isTransientAskError } from '../lib/detail-ask-stop';

const detail = readFileSync(new URL('../app/company-detail.tsx', import.meta.url), 'utf8');

test('blank in-flight turn is removed; partial and older answers stay', () => {
  const older = { role: 'assistant', text: '上一句还在' };
  const blank = [
    { role: 'user', text: '营收多少' },
    { role: 'assistant', text: '' },
  ];
  assert.deepEqual(dropBlankInFlightTurn([older, ...blank]), [older]);
  assert.deepEqual(dropBlankInFlightTurn([{ role: 'assistant', text: '   ' }]), []);
  const partial = [
    { role: 'user', text: '营收多少' },
    { role: 'assistant', text: '本期营业收入' },
  ];
  assert.equal(dropBlankInFlightTurn(partial), partial);
});

test('only transport failures retry; aborts and content errors do not', () => {
  assert.equal(isTransientAskError(new TypeError('Failed to fetch')), true);
  assert.equal(isTransientAskError(new Error('问答服务暂时不可用')), true);
  assert.equal(isTransientAskError(new Error('AI 调用超时，请稍后再试。')), true);
  assert.equal(isTransientAskError(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), true);
  assert.equal(isTransientAskError(Object.assign(new Error('Aborted'), { name: 'AbortError' })), false);
  assert.equal(isTransientAskError(new Error('关注内容过长，请减少摘录后再试')), false);
  assert.equal(isTransientAskError(new Error('暂无法回答：未返回足够证据。')), false);
});

test('detail voice takeover drops a blank turn and a stopped blank turn is not a failure line', () => {
  assert.equal(ASK_STOPPED_LINE, '已停止');
  assert.ok(detail.includes("abortInFlightAsk('voice-takeover')"));
  assert.ok(detail.includes('dropBlankInFlightTurn'));
  assert.ok(detail.includes('ASK_STOPPED_LINE'));
  assert.ok(!detail.includes('已停止生成'));
  assert.ok(detail.includes('isTransientAskError'));
  assert.ok(detail.includes('retried: true'));
  assert.equal((detail.match(/retried: true/g) ?? []).length, 2);
});
