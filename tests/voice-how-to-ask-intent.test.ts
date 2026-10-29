import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isVoiceHowToAskIntent,
  pickHowToAskExamples,
  voiceHowToAskSpeech,
  HOW_TO_ASK_BY_INDUSTRY,
  HOW_TO_ASK_GENERIC,
} from '../lib/voice/how-to-ask-intent';
import { parseLocalCommand } from '../lib/voice/local-command';
import { isVoiceCapabilityIntent } from '../lib/voice/meta-intent';
import { isVoiceFarewell } from '../lib/voice/farewell-intent';

const noWindow = { lastPageNav: null as null, now: 5_000_000 };

test('isVoiceHowToAskIntent matches natural how/what-to-ask variants', () => {
  const yes = [
    '我该怎么提问',
    '怎么问',
    '怎样问',
    '怎么提问',
    '可以问什么',
    '问什么好',
    '问啥好',
    '该问什么',
    '有什么可以问的',
    '有哪些能问的问题',
    '不知道问什么',
    '给我几个问题',
    '推荐一些问题',
    '示例问题',
    '提问建议',
    '问点什么',
    '教我怎么问',
    '能问哪些',
    '请帮我问什么好',
    '  怎么问？  ',
  ];
  for (const s of yes) {
    assert.equal(isVoiceHowToAskIntent(s), true, JSON.stringify(s));
  }
});

test('isVoiceHowToAskIntent rejects finance asks and other intents', () => {
  const no = [
    '营业收入是多少',
    '怎么问营收同比算出来的',
    '你能干什么',
    '介绍一下你自己',
    '你是谁',
    '下一页',
    '翻到第八页',
    '再见',
    '退下吧',
    '回首页',
    '风险因素有哪些',
    '你好',
    '谢谢',
    '毛利率同比',
    '',
  ];
  for (const s of no) {
    assert.equal(isVoiceHowToAskIntent(s), false, JSON.stringify(s));
  }
});

test('parseLocalCommand routes how-to-ask without stealing capability/farewell', () => {
  assert.deepEqual(parseLocalCommand('我该怎么提问', noWindow), { kind: 'how-to-ask' });
  assert.deepEqual(parseLocalCommand('可以问什么', noWindow), { kind: 'how-to-ask' });
  assert.deepEqual(parseLocalCommand('问什么好', noWindow), { kind: 'how-to-ask' });
  assert.deepEqual(parseLocalCommand('你能干什么', noWindow), { kind: 'capability' });
  assert.deepEqual(parseLocalCommand('再见', noWindow), { kind: 'farewell' });
  assert.equal(parseLocalCommand('营业收入是多少', noWindow), null);

  // capability detector and farewell stay independent
  assert.equal(isVoiceCapabilityIntent('你能干什么'), true);
  assert.equal(isVoiceHowToAskIntent('你能干什么'), false);
  assert.equal(isVoiceFarewell('再见'), true);
  assert.equal(isVoiceHowToAskIntent('再见'), false);
});

test('pickHowToAskExamples prefers industry map then generic', () => {
  const baijiu = pickHowToAskExamples('白酒');
  assert.equal(baijiu.industryKey, '白酒');
  assert.ok(baijiu.examples.length >= 2 && baijiu.examples.length <= 4);
  assert.ok(baijiu.examples.some((q) => /合同负债|预收款|吨价|毛利率|收入/.test(q)));

  const bank = pickHowToAskExamples('商业银行');
  assert.equal(bank.industryKey, '银行');
  assert.ok(bank.examples.some((q) => /息差|不良|非利息|贷款/.test(q)));

  const bankExact = pickHowToAskExamples('银行');
  assert.equal(bankExact.industryKey, '银行');
  assert.ok(bankExact.examples.some((q) => /息差|不良|非利息|贷款/.test(q)));

  const generic = pickHowToAskExamples(null);
  assert.equal(generic.industryKey, null);
  assert.deepEqual([...generic.examples], [...HOW_TO_ASK_GENERIC.slice(0, 4)]);

  const pending = pickHowToAskExamples('待分类');
  assert.equal(pending.industryKey, null);
});

test('voiceHowToAskSpeech detail vs home', () => {
  const detailBaijiu = voiceHowToAskSpeech('白酒', 'detail');
  assert.match(detailBaijiu, /白酒视角/);
  assert.match(detailBaijiu, /一，/);
  assert.match(detailBaijiu, /二，/);
  assert.doesNotMatch(detailBaijiu, /买入|卖出|目标价|推荐持有/);

  const detailGeneric = voiceHowToAskSpeech(null, 'detail');
  assert.match(detailGeneric, /^可以这样问：/);
  assert.match(detailGeneric, /营业收入/);

  const home = voiceHowToAskSpeech(null, 'home');
  assert.match(home, /先打开一家公司/);
  assert.match(home, /营业收入|归母净利润|风险/);
});

test('every industry skill key in HOW_TO_ASK_BY_INDUSTRY has 2–4 non-empty asks', () => {
  for (const [key, list] of Object.entries(HOW_TO_ASK_BY_INDUSTRY)) {
    assert.ok(list.length >= 2 && list.length <= 4, key);
    for (const q of list) {
      assert.ok(q.trim().length >= 4, `${key}: ${q}`);
      assert.doesNotMatch(q, /买入|卖出|目标价|加仓|仓位/);
    }
  }
});
