import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { homeVoiceFinalizeText, matchedVoiceSearchText } from '../lib/home-voice-flow';
import { isHomeChitchatUtterance } from '../lib/home-chitchat';
import { resolveListedCompanies } from '../lib/home-search';

function voiceSearchUpdate(raw: string) {
  if (isHomeChitchatUtterance(raw)) return null;
  return matchedVoiceSearchText(raw, true, resolveListedCompanies(raw).length);
}

test('chitchat and unrecognized companies never request a search update', () => {
  for (const raw of ['你能干啥？', '今天天气怎么样', 'xxxxx', '999999', '虚构火星公司业绩怎么样']) {
    assert.equal(voiceSearchUpdate(raw), null, raw);
  }
});

test('recognized company and multi-match original question may replace search; manual is untouched', () => {
  assert.equal(voiceSearchUpdate('贵州茅台营收多少'), '贵州茅台营收多少');
  assert.equal(voiceSearchUpdate('东鹏最近业绩好不好'), '东鹏最近业绩好不好');
  assert.equal(matchedVoiceSearchText('贵州茅台', false, 1), null);
  assert.equal(matchedVoiceSearchText('xxxxx', true, 0), null);
});

test('finalize uses current ASR instead of an unrelated saved manual search', () => {
  assert.equal(homeVoiceFinalizeText('今天天气怎样', '贵州茅台', false), '今天天气怎样');
  assert.equal(homeVoiceFinalizeText('', '贵州茅台', false), '');
  assert.equal(homeVoiceFinalizeText('错字', '手动纠正', true), '手动纠正');
});

test('home source has no live-partial/search flash and errors stay in its own dock', () => {
  const home = readFileSync(new URL('../app/report-home.tsx', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('../components/voice-session-provider.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../app/company-detail.tsx', import.meta.url), 'utf8');
  assert.ok(!home.includes('setSearch(voice.partial)'));
  assert.ok(!home.includes("setSearch(isHomeChitchatUtterance(text)"));
  assert.ok(home.includes('voice.setHideFloat(true)') && home.includes('voice.setHideFloat(false)'));
  assert.ok(provider.includes('toast && !hideFloat'));
  assert.ok(home.includes('rh-eva-notice') && home.includes('voice.active || voice.toast'));
  assert.ok(detail.includes('hasReportAuditRisk(selected)'));
  assert.ok(detail.includes('return () => voice.setReportAuditRisk(false)'));
});
