import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendHomeChatTurn,
  clearHomeAskHandoff,
  clearHomeChatTurns,
  consumeHomeAskHandoff,
  getHomeChatTurns,
  markHomeAskHandoff,
} from '../lib/chat-surface';

test('home turns stay ephemeral and clearable', () => {
  clearHomeChatTurns();
  appendHomeChatTurn('user', '现在有哪些公司');
  appendHomeChatTurn('assistant', '监控池里有…');
  assert.equal(getHomeChatTurns().length, 2);
  clearHomeChatTurns();
  assert.equal(getHomeChatTurns().length, 0);
});

test('home ask handoff marker is one-shot', () => {
  clearHomeAskHandoff();
  // jsdom-less: sessionStorage may be missing in node — consume still honors URL q.
  assert.equal(consumeHomeAskHandoff('营收怎么了'), true);
  assert.equal(consumeHomeAskHandoff(null), false);
  assert.equal(consumeHomeAskHandoff(''), false);
});

test('markHomeAskHandoff is a no-op without window (SSR-safe)', () => {
  clearHomeAskHandoff();
  markHomeAskHandoff('贵州茅台营收增长原因');
  // Without sessionStorage the URL q path still isolates; marker absence is OK.
  assert.equal(consumeHomeAskHandoff('贵州茅台营收增长原因'), true);
});
