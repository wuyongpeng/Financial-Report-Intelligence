import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceConfirmPrompt,
  buildVoicePickPrompt,
  listedMatchKind,
  needsVoiceCompanyConfirm,
  parseVoiceConfirmReply,
  parseVoicePickChoice,
} from '../lib/home-voice-flow';

const maotai = { code: '600519', name: '贵州茅台' };
const dongpengHold = { code: '001328', name: '东鹏控股' };
const dongpengBev = { code: '605499', name: '东鹏饮料' };

test('listedMatchKind: code / exact / alias / variant / fuzzy', () => {
  assert.equal(listedMatchKind('600519', maotai), 'code');
  assert.equal(listedMatchKind('贵州茅台最近怎么样', maotai), 'exact-name');
  assert.equal(listedMatchKind('茅台净利润多少', maotai), 'alias');
  assert.equal(listedMatchKind('美的', { code: '000333', name: '美的集团' }), 'alias');
  // stem that is a nameVariant of 东鹏控股
  assert.equal(listedMatchKind('东鹏控股', dongpengHold), 'exact-name');
  // loose contains without being alias/variant of 贵州茅台 — use a fake fuzzy
  assert.equal(listedMatchKind('贵州茅', maotai), 'fuzzy');
});

test('needsVoiceCompanyConfirm only for fuzzy voice hits', () => {
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: true, query: '贵州茅', listed: maotai }),
    true,
  );
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: true, query: '贵州茅台', listed: maotai }),
    false,
  );
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: true, query: '600519', listed: maotai }),
    false,
  );
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: true, userEdited: true, query: '贵州茅', listed: maotai }),
    false,
  );
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: false, query: '贵州茅', listed: maotai }),
    false,
  );
  assert.equal(
    needsVoiceCompanyConfirm({ fromVoice: true, query: '茅台营收多少', listed: maotai }),
    false,
  );
});

test('parseVoiceConfirmReply', () => {
  assert.equal(parseVoiceConfirmReply('确定'), 'yes');
  assert.equal(parseVoiceConfirmReply('是的'), 'yes');
  assert.equal(parseVoiceConfirmReply('不是'), 'no');
  assert.equal(parseVoiceConfirmReply('取消'), 'no');
  assert.equal(parseVoiceConfirmReply('东鹏饮料'), null);
});

test('parseVoicePickChoice: ordinal and name', () => {
  const cands = [dongpengHold, dongpengBev];
  assert.deepEqual(parseVoicePickChoice('2', cands), { kind: 'pick', index: 1 });
  assert.deepEqual(parseVoicePickChoice('第二个', cands), { kind: 'pick', index: 1 });
  assert.deepEqual(parseVoicePickChoice('东鹏饮料', cands), { kind: 'pick', index: 1 });
  assert.deepEqual(parseVoicePickChoice('东鹏控股', cands), { kind: 'pick', index: 0 });
  assert.deepEqual(parseVoicePickChoice('取消', cands), { kind: 'cancel' });
  assert.equal(parseVoicePickChoice('随便', cands), null);
});

test('buildVoicePickPrompt mentions multi match and names', () => {
  const prompt = buildVoicePickPrompt([dongpengHold, dongpengBev]);
  assert.match(prompt, /多个匹配/);
  assert.match(prompt, /东鹏控股/);
  assert.match(prompt, /东鹏饮料/);
  assert.match(prompt, /序号/);
});

test('buildVoiceConfirmPrompt', () => {
  assert.match(buildVoiceConfirmPrompt(maotai), /贵州茅台/);
  assert.match(buildVoiceConfirmPrompt(maotai), /600519/);
});
