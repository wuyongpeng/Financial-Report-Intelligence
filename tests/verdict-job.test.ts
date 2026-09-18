import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVerdictCompletion, applyVerdictStreamEvent, emptyVerdictStreamState, orderVerdictProviders, VERDICT_HARD_ABORT_MS, VERDICT_TTFT_MS } from '../lib/report-verdict-llm';
import { shouldKickVerdictJob, type VerdictPeek } from '../lib/report-verdict-store';

function peek(partial: Partial<VerdictPeek>): VerdictPeek {
  return {
    status: 'pending',
    value: null,
    error: null,
    stale: false,
    ageMs: 0,
    ...partial,
  };
}

test('polling GET does not kick a second job for fresh pending rows', () => {
  assert.equal(shouldKickVerdictJob(peek({ status: 'pending', ageMs: 20_000 })), false);
  assert.equal(shouldKickVerdictJob(peek({ status: 'failed' })), false);
  assert.equal(shouldKickVerdictJob(peek({ status: 'ready' })), false);
  assert.equal(shouldKickVerdictJob(peek({ status: 'absent' })), true);
  assert.equal(shouldKickVerdictJob(peek({ status: 'pending', stale: true })), true);
});

test('extractVerdictCompletion reads JSON after empty content or think tags', () => {
  const payload = JSON.stringify({
    verdict: { label: '稳健增长', summary: '经营节奏平稳。' },
    changes: [],
    modules: [],
  });
  assert.equal(extractVerdictCompletion(JSON.stringify({
    choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: '还在分析' } }],
  })).json, null);
  assert.equal(extractVerdictCompletion(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: `<think>先想</think>\n${payload}` } }],
  })).json, payload);
  assert.equal(extractVerdictCompletion(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: payload } }],
  })).json, payload);
});

test('orderVerdictProviders prefers MiniMax before GLM for JSON generation', () => {
  const ordered = orderVerdictProviders([
    { id: 'primary', baseUrl: 'https://gw.example/v1', model: 'thudm/glm-5.2' },
    { id: 'thudm/glm-5.1', baseUrl: 'https://gw.example/v1', model: 'thudm/glm-5.1' },
    { id: 'minimax/MiniMax-M2.7-highspeed', baseUrl: 'https://gw.example/v1', model: 'minimax/MiniMax-M2.7-highspeed' },
  ]);
  assert.deepEqual(ordered.map((item) => item.model), [
    'minimax/MiniMax-M2.7-highspeed',
    'thudm/glm-5.2',
    'thudm/glm-5.1',
  ]);
});

test('verdict aborts at 30s without a first token and at 5 minutes if unfinished', () => {
  assert.equal(VERDICT_TTFT_MS, 30_000);
  assert.equal(VERDICT_HARD_ABORT_MS, 300_000);
  assert.ok(VERDICT_TTFT_MS < VERDICT_HARD_ABORT_MS);
});

test('applyVerdictStreamEvent treats reasoning as first token and keeps later JSON', () => {
  let state = emptyVerdictStreamState();
  state = applyVerdictStreamEvent(state, JSON.stringify({
    choices: [{ delta: { reasoning_content: '先看利润' } }],
  }));
  assert.equal(state.sawToken, true);
  assert.equal(state.reasoning, '先看利润');
  const payload = JSON.stringify({
    verdict: { label: '稳健增长', summary: '经营节奏平稳。' },
    changes: [],
    modules: [],
  });
  state = applyVerdictStreamEvent(state, JSON.stringify({
    choices: [{ delta: { content: payload }, finish_reason: 'stop' }],
  }));
  assert.equal(state.content, payload);
  assert.equal(state.finish, 'stop');
  state = applyVerdictStreamEvent(state, '[DONE]');
  assert.equal(state.content, payload);
});
