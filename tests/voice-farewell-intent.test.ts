import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceFarewell, pickVoiceFarewellLine, FAREWELL_LINES } from '../lib/voice/farewell-intent';

test('isVoiceFarewell matches clear dismiss phrases', () => {
  const yes = [
    '知道了，退下吧',
    '退下吧',
    '再见',
    '拜拜',
    '先这样',
    '没事了',
    '结束吧',
    '不用了',
    '走了',
    '可以了谢谢',
    '停止语音',
    '退出语音',
    '结束语音',
    '好的再见',
    '那我先走了',
    '就这样吧',
  ];
  for (const s of yes) {
    assert.equal(isVoiceFarewell(s), true, s);
  }
});

test('isVoiceFarewell rejects finance / bare acknowledgment', () => {
  const no = [
    '营收是多少',
    '知道了',
    '好的',
    '嗯',
    '这个季度业绩好不好',
    '毛利率多少',
    '下一页',
    '分析一下扣非净利润',
  ];
  for (const s of no) {
    assert.equal(isVoiceFarewell(s), false, s);
  }
});

test('pickVoiceFarewellLine returns a short warm Eva line', () => {
  const line = pickVoiceFarewellLine(0);
  assert.ok(FAREWELL_LINES.includes(line as (typeof FAREWELL_LINES)[number]));
  assert.ok(line.length <= 24);
  assert.match(line, /Eva/);
  assert.match(line, /问|叫/);
});
