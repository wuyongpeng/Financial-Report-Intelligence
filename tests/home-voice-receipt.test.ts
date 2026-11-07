import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { HomeVoiceTurns, HOME_UNMATCHED_RECEIPT, HOME_VOICE_FAILURE_RECEIPT, acceptsHomeBargeSpeech } from '../lib/voice/home-turn';
import { finalAsrTranscript } from '../lib/voice/final-transcript';

test('accepted ASR is visible before slow/failed AI and repeated route entry never duplicates it', async () => {
  const turns = new HomeVoiceTurns(); const bubbles: string[] = [];
  for (const raw of ['这个名字没搜到', '123456', '我不知道怎么问', '第二个', '加入']) {
    const turn = turns.begin();
    assert.ok(turns.recordUser(turn, raw, text => bubbles.push(text)));
    assert.equal(bubbles.at(-1), raw); // Before awaiting any remote or route result.
    assert.equal(turns.recordUser(turn, raw, text => bubbles.push(text)), false);
    await Promise.reject(new Error('AI unavailable')).catch(() => undefined);
    assert.equal(bubbles.filter(text => text === raw).length, 1);
    assert.ok(turns.needsReceipt(turn));
    turns.recordReply();
    assert.equal(turns.needsReceipt(turn), false);
  }
  assert.match(HOME_UNMATCHED_RECEIPT, /收到了/);
  assert.match(HOME_VOICE_FAILURE_RECEIPT, /失败.*已保留/);
});

test('late replies, close, navigation and interruption cannot add old-turn receipts', () => {
  const turns = new HomeVoiceTurns(); const old = turns.begin();
  const current = turns.begin();
  assert.equal(turns.recordUser(old, '旧问题', () => assert.fail('stale bubble')), false);
  assert.equal(turns.needsReceipt(old), false);
  assert.equal(turns.recordUser(current, '  ', () => assert.fail('empty bubble')), false);
  turns.cancel();
  assert.equal(turns.needsReceipt(current), false);
  assert.equal(acceptsHomeBargeSpeech('当前首页公司', '当前首页公司共有十家'), false, 'echo guard stays enabled');
  assert.equal(acceptsHomeBargeSpeech('啊', ''), false);
});

test('blank final retains real partial, nonblank final wins, no ASR text never invents a message', () => {
  assert.equal(finalAsrTranscript('  ', '  想看立讯精密  '), '想看立讯精密');
  assert.equal(finalAsrTranscript('', '没有搜到的名字'), '没有搜到的名字');
  assert.equal(finalAsrTranscript('最终修正', '前面的片段'), '最终修正');
  assert.equal(finalAsrTranscript(' ', '\n'), '');
});

test('real homepage receiver records before route/AI; shared final receiver validates fallback before takeover', () => {
  const home = readFileSync(new URL('../app/report-home.tsx', import.meta.url), 'utf8');
  const handler = home.slice(home.indexOf('const handler = async (text:'), home.indexOf('voice.setUtteranceHandler(handler)'));
  assert.ok(handler.indexOf('recordUser(turn, text') < handler.indexOf('await route(text, turn)'));
  assert.ok(handler.includes('needsReceipt(turn)'));
  assert.ok(handler.includes("pushTurn('assistant', HOME_VOICE_FAILURE_RECEIPT)"));
  const search = home.slice(home.indexOf('async function submitHomeSearch'), home.indexOf('onSearchSubmitRef.current ='));
  assert.ok(search.indexOf('recordUser(turn, raw') < search.indexOf('await requestAssistantTurn'));
  assert.ok(!home.includes("pushTurn('user', raw)"));
  assert.ok(home.includes('log.scrollTop = log.scrollHeight'));
  const provider = readFileSync(new URL('../components/voice-session-provider.tsx', import.meta.url), 'utf8');
  assert.ok(provider.includes('const finalText = finalAsrTranscript(ev.text, voicePartialRef.current)'));
  assert.ok(provider.includes('if (!takeOver(finalText))'));
});
