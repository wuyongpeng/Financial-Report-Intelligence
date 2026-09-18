import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVerdictCompletion } from '../lib/report-verdict-llm';
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
