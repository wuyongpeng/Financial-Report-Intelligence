import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVoiceNavIntent,
  parseVoicePageContinue,
  isVoiceHomeIntent,
  pickVoiceHomeLine,
  HOME_CONFIRM_LINES,
  VOICE_PAGE_CONTINUE_WINDOW_MS,
} from '../lib/voice/nav-intent';
import { isVoiceFarewell } from '../lib/voice/farewell-intent';
import { speakableText } from '../lib/voice/speakable';

test('parseVoiceNavIntent next/prev/goto', () => {
  assert.deepEqual(parseVoiceNavIntent('下一页'), { kind: 'next' });
  assert.deepEqual(parseVoiceNavIntent('上一页。'), { kind: 'prev' });
  assert.deepEqual(parseVoiceNavIntent('跳到第48页'), { kind: 'goto', page: 48 });
  assert.deepEqual(parseVoiceNavIntent('第12页'), { kind: 'goto', page: 12 });
  assert.equal(parseVoiceNavIntent('今年毛利率多少'), null);
});

test('parseVoiceNavIntent broader next/prev natural phrases', () => {
  const nextYes = [
    '往下翻一页',
    '向下翻一页',
    '往下翻',
    '向下翻',
    '翻下去',
    '翻后面',
    '再下一页',
    '往后翻一页',
    '请帮我往下翻',
    '再往下翻',
  ];
  for (const s of nextYes) {
    assert.deepEqual(parseVoiceNavIntent(s), { kind: 'next' }, s);
  }
  const prevYes = [
    '往上翻一页',
    '向上翻一页',
    '往上翻',
    '向上翻',
    '翻上去',
    '翻前面',
    '再上一页',
    '往前翻一页',
    '请帮我往上翻',
    '再往上翻',
  ];
  for (const s of prevYes) {
    assert.deepEqual(parseVoiceNavIntent(s), { kind: 'prev' }, s);
  }
  // Must not steal content /财报 questions.
  const no = [
    '往下翻看营收是多少',
    '往上看利润表怎么说',
    '继续分析毛利率',
    '接着说一下风险',
    '营业收入同比多少',
  ];
  for (const s of no) {
    assert.equal(parseVoiceNavIntent(s), null, s);
  }
});

test('parseVoicePageContinue repeats last next/prev within 12s window', () => {
  const now = 1_000_000;
  const lastNext = { kind: 'next' as const, at: now - 3_000 };
  const lastPrev = { kind: 'prev' as const, at: now - 3_000 };
  const stale = { kind: 'next' as const, at: now - VOICE_PAGE_CONTINUE_WINDOW_MS - 1 };

  assert.equal(VOICE_PAGE_CONTINUE_WINDOW_MS, 12_000);

  for (const s of ['继续', '再翻', '再翻一页', '继续翻', '接着翻', '继续翻页']) {
    assert.deepEqual(parseVoicePageContinue(s, lastNext, now), { kind: 'next' }, s);
    assert.deepEqual(parseVoicePageContinue(s, lastPrev, now), { kind: 'prev' }, s);
  }

  // Directional continue — maps without relying on last, but still works with last.
  assert.deepEqual(parseVoicePageContinue('再往下', null, now), { kind: 'next' });
  assert.deepEqual(parseVoicePageContinue('再往上', null, now), { kind: 'prev' });
  assert.deepEqual(parseVoicePageContinue('继续往下翻', lastPrev, now), { kind: 'next' });
  assert.deepEqual(parseVoicePageContinue('接着往上', lastNext, now), { kind: 'prev' });

  // Bare 继续 with no / stale last → not nav (leave to chat / soft boundary).
  assert.equal(parseVoicePageContinue('继续', null, now), null);
  assert.equal(parseVoicePageContinue('再翻', stale, now), null);
  assert.equal(parseVoicePageContinue('继续分析营收', lastNext, now), null);
  assert.equal(parseVoiceNavIntent('继续'), null); // bare continue is not a primary nav phrase
});

test('parseVoiceNavIntent home / switch-company broad phrases', () => {
  const yes = [
    '回首页',
    '回到首页',
    '去首页',
    '打开首页',
    '返回首页',
    '回主页',
    '去主页',
    '跳到首页',
    '换一家',
    '换个公司',
    '换一家公司',
    '换个股票',
    '换个标的',
    '我想问别的',
    '问另一家',
    '看看别的公司',
    '搜索其他公司',
    '打开搜索',
    '重新搜索',
    '退出这个公司',
    '离开详情',
    '不想看这个了',
  ];
  for (const s of yes) {
    assert.equal(isVoiceHomeIntent(s), true, s);
    assert.deepEqual(parseVoiceNavIntent(s), { kind: 'home' }, s);
  }
});

test('home intent does not steal page nav or farewell', () => {
  assert.deepEqual(parseVoiceNavIntent('下一页'), { kind: 'next' });
  assert.deepEqual(parseVoiceNavIntent('第3页'), { kind: 'goto', page: 3 });
  assert.equal(isVoiceHomeIntent('下一页'), false);
  assert.equal(isVoiceHomeIntent('营收是多少'), false);
  assert.equal(isVoiceHomeIntent('这个季度业绩好不好'), false);

  // Farewell stays farewell — not home.
  const farewell = ['退下吧', '知道了，退下吧', '再见', '退出语音', '停止语音', '拜拜'];
  for (const s of farewell) {
    assert.equal(isVoiceHomeIntent(s), false, `home? ${s}`);
    assert.equal(isVoiceFarewell(s), true, `farewell? ${s}`);
    assert.equal(parseVoiceNavIntent(s), null, `nav? ${s}`);
  }
});

test('pickVoiceHomeLine is short confirm', () => {
  const line = pickVoiceHomeLine(0);
  assert.ok(HOME_CONFIRM_LINES.includes(line as (typeof HOME_CONFIRM_LINES)[number]));
  assert.ok(line.length <= 12);
  assert.match(line, /首页/);
});

test('speakableText strips cites', () => {
  const out = speakableText('营收增长【E1】明显 [P12]，详见【第 3 页】。');
  assert.equal(out.includes('E1'), false);
  assert.equal(out.includes('P12'), false);
  assert.equal(out.includes('第 3 页'), false);
  assert.match(out, /营收增长/);
});
