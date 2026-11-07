import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceActivityLabels, voiceActivityState } from '../components/voice-activity';

test('voice visuals distinguish listening, thinking, reading and send confirmation', () => {
  assert.equal(voiceActivityState({}), 'idle');
  assert.equal(voiceActivityState({ listening: true }), 'listening');
  assert.equal(voiceActivityState({ busy: true }), 'thinking');
  assert.equal(voiceActivityState({ busy: true, speaking: true }), 'speaking');
  assert.equal(voiceActivityState({ arming: true, listening: true }), 'arming');
});

test('every visual state has a readable text equivalent, not just animation or color', () => {
  for (const state of ['idle', 'listening', 'thinking', 'speaking', 'arming'] as const) {
    assert.ok(voiceActivityLabels[state].length > 0);
  }
});
