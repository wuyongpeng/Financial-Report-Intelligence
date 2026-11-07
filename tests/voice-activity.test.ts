import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VoiceActivityStatus, voiceActivityLabels, voiceActivityState } from '../components/voice-activity';

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


test('listening status is screen-reader-only; other useful status labels stay visible', () => {
  const listening = renderToStaticMarkup(React.createElement(VoiceActivityStatus, { state: 'listening', className: 'rh-eva-status' }));
  assert.ok(listening.includes('eva-voice-status-sr-only'));
  assert.ok(listening.includes('role="status"'));
  assert.ok(listening.includes('正在聆听'));
  for (const state of ['speaking', 'thinking', 'arming', 'idle'] as const) {
    const html = renderToStaticMarkup(React.createElement(VoiceActivityStatus, { state }));
    assert.ok(!html.includes('eva-voice-status-sr-only'));
    assert.ok(html.includes(voiceActivityLabels[state]));
  }
});

test('detail custom status keeps its accessible label without changing recognized transcript', () => {
  const html = renderToStaticMarkup(React.createElement(VoiceActivityStatus, { state: 'listening', label: '正在聆听…' }));
  assert.ok(html.includes('正在聆听…'));
  assert.ok(html.includes('eva-voice-status-sr-only'));
});
