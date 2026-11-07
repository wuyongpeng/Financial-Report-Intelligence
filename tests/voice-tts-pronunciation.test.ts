import assert from 'node:assert/strict';
import test from 'node:test';
import { ttsSessionRequest, voiceDefaults, EVA_TTS_VOICE_INSTRUCTION } from '../lib/voice/ws-proxy.mjs';
import { speakableText } from '../lib/voice/speakable';

test('actual gateway session uses documented Seed 2.0 additions.context_texts, not fake phoneme/SSML fields', () => {
  const session = ttsSessionRequest();
  assert.equal(session.namespace, 'BidirectionalTTS');
  assert.equal(session.req_params.speaker, voiceDefaults.ttsSpeaker);
  assert.equal(session.req_params.audio_params.format, 'mp3');
  assert.equal(session.req_params.audio_params.sample_rate, 24000);
  assert.equal(typeof session.req_params.additions, 'string');
  const additions = JSON.parse(session.req_params.additions);
  assert.deepEqual(Object.keys(additions), ['context_texts']);
  assert.deepEqual(additions.context_texts, [EVA_TTS_VOICE_INSTRUCTION]);
  assert.match(EVA_TTS_VOICE_INSTRUCTION, /standalone brand name Eva/);
  assert.match(EVA_TTS_VOICE_INSTRUCTION, /American English/);
  assert.match(EVA_TTS_VOICE_INSTRUCTION, /Leave every other word in its original language/);
  assert.ok(!JSON.stringify(session).includes('explicit_language'));
  assert.ok(!Object.keys(session.req_params).some(key => /ssml|phoneme|ipa/.test(key)));
});

test('mixed Chinese and amounts remain speech text, not English-forced or raw IPA instructions', () => {
  assert.equal(speakableText('我是Eva，本期收入3,835.54亿元。'), '我是Eva，本期收入三千八百三十五点五四亿元。');
  assert.equal(speakableText('评价evaluate，EVA-01和EvaX'), '评价evaluate，Eva-01和EvaX');
});
