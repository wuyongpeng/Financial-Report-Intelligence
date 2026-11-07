import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('voice float has automatic-interrupt copy without a manual interrupt button', () => {
  const float = source('../components/voice-float.tsx');
  assert.ok(float.includes('回答朗读中，支持随时打断'));
  assert.ok(!float.includes('onBargeIn'));
  assert.ok(!float.includes('说话或点「打断」'));
  assert.ok(float.includes('onClick={onEnd}'));
  assert.ok(float.includes('onClick={onFinalize}'));
  assert.ok(float.includes('onClick={onCancelArm}'));
});

test('manual float callback is removed but default local ASR takeover remains', () => {
  const provider = source('../components/voice-session-provider.tsx');
  const detail = source('../app/company-detail.tsx');
  assert.ok(!provider.includes('setBargeInHandler') && !provider.includes('onBargeIn'));
  assert.ok(detail.includes("void armBargeInAsr('speaking')"));
  assert.ok(detail.includes("void armBargeInAsr('asking')"));
  assert.ok(detail.includes('if (isMeaningfulBargePartial(raw))'));
  assert.ok(detail.includes('takeOver(raw)'));
  assert.ok(detail.includes('tts?.abort()'));
  assert.ok(detail.includes('voiceConvRef.current = true'));
  assert.ok(detail.includes('if (asking || voiceSpeaking) bargeInFromVoice()'));
});
