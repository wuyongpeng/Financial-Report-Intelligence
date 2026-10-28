import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_BARGE_MIN_CHARS, isMeaningfulBargePartial } from '../lib/voice/timing';

test('barge-in partial gate ignores empty / single-char noise', () => {
  assert.equal(VOICE_BARGE_MIN_CHARS, 2);
  assert.equal(isMeaningfulBargePartial(''), false);
  assert.equal(isMeaningfulBargePartial(' '), false);
  assert.equal(isMeaningfulBargePartial('啊'), false);
  assert.equal(isMeaningfulBargePartial(' 啊 '), false);
});

test('barge-in partial gate accepts two+ chars', () => {
  assert.equal(isMeaningfulBargePartial('营收'), true);
  assert.equal(isMeaningfulBargePartial('先别念了'), true);
  assert.equal(isMeaningfulBargePartial(' 停一下 '), true);
});
