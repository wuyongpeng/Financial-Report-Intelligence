import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleFocusPrompt, displayFocusPrompt, focusAttachNote, focusContextBlock, mergeLiveSelectionFocus, parseFocus } from '../lib/focus-prompt';

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

test('display keeps typed question without attach suffix', () => {
  const focus = parseFocus([{ kind: 'metric', text: 'ROE 12%', title: '净资产收益率' }]);
  assert.equal(displayFocusPrompt('请解读', focus), '请解读');
  assert.equal(displayFocusPrompt('明天啥天气', focus), '明天啥天气');
});

test('attach note is separate from bubble text', () => {
  const focus = parseFocus([{ kind: 'pdf', text: '长期应付职工薪酬', page: 7 }]);
  assert.equal(focusAttachNote(focus), '已带上 1 段原文');
  assert.equal(focusAttachNote([]), '');
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

test('mergeLiveSelectionFocus prepends live PDF quote without requiring clip click', () => {
  const base = parseFocus([{ kind: 'pdf', text: 'already clipped', page: 2 }]);
  const merged = mergeLiveSelectionFocus(base, { quote: '长期应付职工薪酬', page: 7 });
  assert.equal(merged[0].text, '长期应付职工薪酬');
  assert.equal(merged[0].page, 7);
  assert.equal(merged[0].kind, 'pdf');
  assert.equal(merged.length, 2);
});

test('mergeLiveSelectionFocus skips tiny and duplicate selections', () => {
  const base = parseFocus([{ kind: 'pdf', text: '同一段原文', page: 3 }]);
  assert.deepEqual(mergeLiveSelectionFocus(base, { quote: '一', page: 3 }), base);
  assert.deepEqual(mergeLiveSelectionFocus(base, { quote: '同一段原文', page: 3 }), base);
  assert.deepEqual(mergeLiveSelectionFocus(base, null), base);
});
