import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleFocusPrompt, displayFocusPrompt, focusContextBlock, parseFocus } from '../lib/focus-prompt';

test('assembles pdf focus frame with typed question', () => {
  const focus = parseFocus([{ kind: 'pdf', text: '营业收入同比增长12%', page: 12 }]);
  const out = assembleFocusPrompt('这些营收合理吗？', focus);
  assert.match(out, /用户在财报pdf中圈定并关注的信息有“营业收入同比增长12%”。/);
  assert.match(out, /这些营收合理吗？/);
  assert.doesNotMatch(out, /怎么看待这些数据$/);
});

test('assembles default closer when only clips', () => {
  const focus = parseFocus([
    { kind: 'pdf', text: 'aaa', page: 1 },
    { kind: 'finding', text: '营收同比 +10%。本期 1 亿', title: '营收同比 +10%' },
  ]);
  const out = assembleFocusPrompt('怎么看待这些数据', focus);
  assert.match(out, /用户在财报pdf中圈定并关注的信息有“aaa”。/);
  assert.match(out, /用户从概览中关注的要点有“营收同比 \+10%：营收同比 \+10%。本期 1 亿”。/);
  assert.match(out, /怎么看待这些数据$/);
});

test('display mentions attached focus', () => {
  const focus = parseFocus([{ kind: 'metric', text: 'ROE 12%', title: '净资产收益率' }]);
  assert.equal(displayFocusPrompt('请解读', focus), '请解读（已带上 1 条概览）');
});

test('focus context block lists items', () => {
  const block = focusContextBlock(parseFocus([{ kind: 'text', text: 'hello world', page: 3 }]));
  assert.match(block, /财报原文第3页/);
  assert.match(block, /hello world/);
});

test('parseFocus truncates long quotes instead of rejecting', () => {
  const long = '甲'.repeat(900);
  const [item] = parseFocus([{ kind: 'pdf', text: long, page: 2 }]);
  assert.ok(item.text.length <= 600);
  assert.ok(item.text.endsWith('…'));
});
