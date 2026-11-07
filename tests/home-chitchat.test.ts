import test from 'node:test';
import assert from 'node:assert/strict';
import {
  homeChitchatSystemPrompt,
  homeGreetingNudge,
  isChitchatResidue,
  isLikelyHomeChitchat,
  looksLikeUnresolvedCompanyAsk,
} from '../lib/home-chitchat';
import {
  buildVoiceJoinPrompt,
  parseVoiceJoinReply,
} from '../lib/home-voice-flow';

test('looksLikeUnresolvedCompanyAsk: finance / name residue vs weather', () => {
  assert.equal(looksLikeUnresolvedCompanyAsk('完全不存在的公司xyz增长如何'), true);
  assert.equal(looksLikeUnresolvedCompanyAsk('xxxxx多少'), true);
  assert.equal(looksLikeUnresolvedCompanyAsk('虚构股份营收多少'), true);
  assert.equal(looksLikeUnresolvedCompanyAsk('今天天气怎么样'), false);
  assert.equal(looksLikeUnresolvedCompanyAsk('你觉得人生有什么意义'), false);
  assert.equal(looksLikeUnresolvedCompanyAsk('讲个笑话'), false);
});

test('isLikelyHomeChitchat routes off-topic, not company filters', () => {
  assert.equal(isLikelyHomeChitchat('今天天气怎么样'), true);
  assert.equal(isLikelyHomeChitchat('讲个笑话'), true);
  assert.equal(isLikelyHomeChitchat('你觉得人工智能如何'), true);
  assert.equal(isLikelyHomeChitchat('xxxxx'), false);
  assert.equal(isLikelyHomeChitchat('贵州茅台'), false);
  assert.equal(isLikelyHomeChitchat('完全不存在的公司xyz增长如何'), false);
});

test('isChitchatResidue', () => {
  assert.equal(isChitchatResidue('今天天气'), true);
  assert.equal(isChitchatResidue('东鹏'), false);
});

test('home prompts stay product-scoped and short', () => {
  const sys = homeChitchatSystemPrompt();
  assert.match(sys, /财报/);
  assert.match(sys, /不荐股|不做证券买卖|买卖/);
  assert.match(sys, /100/);
  assert.match(homeGreetingNudge(), /Eva|财报/);
});

test('parseVoiceJoinReply / buildVoiceJoinPrompt', () => {
  assert.equal(parseVoiceJoinReply('加入'), 'yes');
  assert.equal(parseVoiceJoinReply('加入监控池'), 'yes');
  assert.equal(parseVoiceJoinReply('确定'), 'yes');
  assert.equal(parseVoiceJoinReply('是'), 'yes');
  assert.equal(parseVoiceJoinReply('取消'), 'no');
  assert.equal(parseVoiceJoinReply('否'), 'no');
  assert.equal(parseVoiceJoinReply('东鹏饮料'), null);
  const prompt = buildVoiceJoinPrompt({ code: '605499', name: '东鹏饮料' });
  assert.match(prompt, /是否加入监控池/);
  assert.match(prompt, /东鹏饮料/);
  assert.match(prompt, /605499/);
});
