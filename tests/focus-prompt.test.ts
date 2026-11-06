import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleFocusPrompt, displayFocusPrompt, focusAttachNote, focusContextBlock, mergeLiveSelectionFocus, parseFocus, isFocusReferenceQuestion, readSourceSelection } from '../lib/focus-prompt';

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

test('spoken and typed pointers explicitly bind to the selected quote', () => {
  for (const question of ['这啥意思', '什么意思？', '这是啥', '解释一下', '帮我解释这段', '这是什么意思']) {
    assert.equal(isFocusReferenceQuestion(question), true, question);
    const prompt = assembleFocusPrompt(question, [{ kind: 'pdf', text: '长期应付职工薪酬', page: 121 }]);
    assert.match(prompt, /长期应付职工薪酬/);
    assert.match(prompt, /本轮指代的是上面用户圈定的内容/);
    assert.ok(prompt.endsWith(question));
  }
  assert.equal(isFocusReferenceQuestion('营业收入同比多少'), false);
  assert.equal(isFocusReferenceQuestion('明天天气如何'), false);
});

// Minimal DOM seam: exercise endpoint scoping and text-layer page attribution
// without requiring a PDF renderer, browser selection UI or a microphone.
function sourceSelectionFixture(kind: 'pdf' | 'text' = 'pdf') {
  const layer = {
    matches: (selector: string) => kind === 'pdf' && selector === '.cd-pdf-textlayer',
    getAttribute: () => '121',
  };
  const element = { closest: () => layer };
  const anchor = { nodeType: 3, parentElement: element };
  const focus = { nodeType: 3, parentElement: element };
  const root = { contains: (node: unknown) => node === anchor || node === focus } as unknown as HTMLElement;
  const selection = {
    anchorNode: anchor, focusNode: focus, isCollapsed: false, rangeCount: 1,
    toString: () => ' 长期应付职工薪酬  ',
  } as unknown as Selection;
  return { root, selection };
}

test('readSourceSelection captures live PDF/text quote but never arbitrary UI text', () => {
  const { root, selection } = sourceSelectionFixture();
  assert.deepEqual(readSourceSelection(root, selection, 123), { quote: '长期应付职工薪酬', page: 121, kind: 'pdf' });
  const text = sourceSelectionFixture('text');
  assert.deepEqual(readSourceSelection(text.root, text.selection, 7), { quote: '长期应付职工薪酬', page: 7, kind: 'text' });
  assert.equal(readSourceSelection(root, { ...selection, focusNode: {} } as Selection, 123), null);
  assert.equal(readSourceSelection(null, selection, 123), null);
});

test('pending quote survives collapsed browser selection on mic/input focus', () => {
  const { root, selection } = sourceSelectionFixture();
  const pending = readSourceSelection(root, selection, 123);
  const collapsed = { ...selection, isCollapsed: true } as Selection;
  const live = readSourceSelection(root, collapsed, 123) ?? pending;
  assert.equal(mergeLiveSelectionFocus([], live)[0].text, '长期应付职工薪酬');
  const newest = { ...selection, toString: () => '新的划词' } as Selection;
  assert.equal(mergeLiveSelectionFocus([], readSourceSelection(root, newest, 123) ?? pending)[0].text, '新的划词');
});
