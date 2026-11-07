import assert from 'node:assert/strict';
import test from 'node:test';
import { ttsSessionRequest, voiceDefaults } from '../lib/voice/ws-proxy.mjs';
import { speakableText } from '../lib/voice/speakable';

test('tts session does not send a spelling that adds a spoken h after Eva', () => {
  const session = ttsSessionRequest();
  assert.equal(session.namespace, 'BidirectionalTTS');
  assert.equal(session.req_params.speaker, voiceDefaults.ttsSpeaker);
  assert.equal(session.req_params.audio_params.format, 'mp3');
  assert.equal(session.req_params.audio_params.sample_rate, 24000);
  assert.equal(session.req_params.additions, undefined);
  const packed = JSON.stringify(session);
  assert.ok(!/eevah|ee vuh|vuh/i.test(packed));
  assert.ok(!packed.includes('explicit_language'));
  assert.ok(!Object.keys(session.req_params).some(key => /ssml|phoneme|ipa/.test(key)));
});

test('standalone Eva is spoken as Eeva (/ˈiːvə/) without a trailing h', () => {
  assert.equal(speakableText('我是Eva，本期收入3,835.54亿元。'), '我是Eeva，本期收入三千八百三十五点五四亿元。');
  assert.equal(speakableText('评价evaluate，EVA-01和EvaX'), '评价evaluate，EVA-01和EvaX');
  assert.equal(speakableText('我是Eva'), '我是Eeva');
  assert.ok(!speakableText('谢谢你，Eva。').includes('h'));
});
