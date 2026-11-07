import assert from 'node:assert/strict';
import test from 'node:test';
import { ttsSessionRequest, voiceDefaults, EVA_TTS_PRONUNCIATION } from '../lib/voice/ws-proxy.mjs';
import { speakableText } from '../lib/voice/speakable';

test('actual gateway session uses Seed 2.0 pronunciation_dict, not a tone instruction or SSML', () => {
  const session = ttsSessionRequest();
  assert.equal(session.namespace, 'BidirectionalTTS');
  assert.equal(session.req_params.speaker, voiceDefaults.ttsSpeaker);
  assert.equal(session.req_params.audio_params.format, 'mp3');
  assert.equal(session.req_params.audio_params.sample_rate, 24000);
  assert.equal(typeof session.req_params.additions, 'string');
  const additions = JSON.parse(session.req_params.additions);
  assert.deepEqual(Object.keys(additions), ['pronunciation_dict']);
  assert.deepEqual(additions.pronunciation_dict, { tone: [EVA_TTS_PRONUNCIATION] });
  assert.equal(EVA_TTS_PRONUNCIATION, 'Eevah/ee vuh');
  assert.equal(additions.context_texts, undefined);
  assert.ok(!JSON.stringify(session).includes('explicit_language'));
  assert.ok(!Object.keys(session.req_params).some(key => /ssml|phoneme|ipa/.test(key)));
});

test('standalone Eva is rewritten for English speech; other English tokens stay', () => {
  assert.equal(speakableText('我是Eva，本期收入3,835.54亿元。'), '我是Eevah，本期收入三千八百三十五点五四亿元。');
  assert.equal(speakableText('评价evaluate，EVA-01和EvaX'), '评价evaluate，EVA-01和EvaX');
  assert.ok(!speakableText('我是Eva').includes('伊娃'));
});
