import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mirrors components/voice-session-provider.tsx showFloat.
 * Typed ask sets busy=true; that must never open the realtime float.
 * Only an explicit voice.start() (active session) may show it.
 */
function shouldShowVoiceFloat(state: {
  active: boolean;
  listening?: boolean;
  speaking?: boolean;
  busy?: boolean;
  partial?: string;
}) {
  return state.active;
}

test('typed send / ask busy does not open voice float', () => {
  assert.equal(shouldShowVoiceFloat({ active: false, busy: true }), false);
  assert.equal(shouldShowVoiceFloat({ active: false, speaking: true }), false);
  assert.equal(shouldShowVoiceFloat({ active: false, listening: true, partial: '你好' }), false);
});

test('explicit voice session shows float even while idle between turns', () => {
  assert.equal(shouldShowVoiceFloat({ active: true }), true);
  assert.equal(shouldShowVoiceFloat({ active: true, busy: true }), true);
  assert.equal(shouldShowVoiceFloat({ active: true, listening: true }), true);
});
