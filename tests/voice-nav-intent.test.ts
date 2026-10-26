import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceNavIntent } from '../lib/voice/nav-intent';
import { speakableText } from '../lib/voice/speakable';

test('parseVoiceNavIntent next/prev/goto', () => {
  assert.deepEqual(parseVoiceNavIntent('下一页'), { kind: 'next' });
  assert.deepEqual(parseVoiceNavIntent('上一页。'), { kind: 'prev' });
  assert.deepEqual(parseVoiceNavIntent('跳到第48页'), { kind: 'goto', page: 48 });
  assert.deepEqual(parseVoiceNavIntent('第12页'), { kind: 'goto', page: 12 });
  assert.equal(parseVoiceNavIntent('今年毛利率多少'), null);
});

test('speakableText strips cites', () => {
  const out = speakableText('营收增长【E1】明显 [P12]，详见【第 3 页】。');
  assert.equal(out.includes('E1'), false);
  assert.equal(out.includes('P12'), false);
  assert.equal(out.includes('第 3 页'), false);
  assert.match(out, /营收增长/);
});
