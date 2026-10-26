import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseVoiceNavIntent,
  isVoiceHomeIntent,
  pickVoiceHomeLine,
  HOME_CONFIRM_LINES,
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
