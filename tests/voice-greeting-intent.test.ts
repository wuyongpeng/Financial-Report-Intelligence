import test from 'node:test';
import assert from 'node:assert/strict';
import { isVoiceGreetingOrNoise } from '../lib/voice/greeting-intent';

test('isVoiceGreetingOrNoise matches greetings and filler', () => {
  const yes = [
    '你好',
    '你好你好',
    '您好',
    '嗨',
    '哈喽',
    '在吗',
    '早上好',
    '谢谢',
    '谢谢啊',
    '嗯',
    '啊',
    '呃',
    'hello',
    'Hi',
    '喂',
    '你好啊',
    '  你好  ',
    '……',
    '',
  ];
  for (const s of yes) {
    assert.equal(isVoiceGreetingOrNoise(s), true, JSON.stringify(s));
  }
});

test('isVoiceGreetingOrNoise rejects company names and finance asks', () => {
  const no = [
    '贵州茅台',
    '600519',
    '你好，贵州茅台营收多少',
    '营收是多少',
    '毛利率同比',
    '下一页',
    '回首页',
    '再见',
    '停止语音',
    '分析一下扣非净利润',
    '比亚迪2024年报',
  ];
  for (const s of no) {
    assert.equal(isVoiceGreetingOrNoise(s), false, s);
  }
});
