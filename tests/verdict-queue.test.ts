import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERDICT_BUSY_MS,
  VERDICT_CALL_TIMEOUT_MS,
  VERDICT_CIRCUIT_FAILURES,
  VERDICT_IDLE_MS,
  VERDICT_LOCK_WAIT_MS,
  VERDICT_PAUSE_MS,
  composeVerdictQueueNote,
  verdictQueueDelay,
} from '../lib/verdict-queue';

test('auto verdict budget is slower than one minute and still bounded', () => {
  assert.equal(VERDICT_CALL_TIMEOUT_MS, 300_000);
  assert.equal(VERDICT_LOCK_WAIT_MS, 20_000);
  assert.equal(VERDICT_PAUSE_MS, 15_000);
  assert.ok(VERDICT_CALL_TIMEOUT_MS > 60_000);
  assert.ok(VERDICT_LOCK_WAIT_MS < VERDICT_CALL_TIMEOUT_MS);
  assert.equal(VERDICT_CIRCUIT_FAILURES, 5);
});

test('verdictQueueDelay rests after work and yields quickly when the LLM slot is busy', () => {
  assert.equal(verdictQueueDelay('ok'), VERDICT_PAUSE_MS);
  assert.equal(verdictQueueDelay('fail'), VERDICT_PAUSE_MS);
  assert.equal(verdictQueueDelay('busy'), VERDICT_BUSY_MS);
  assert.equal(verdictQueueDelay('empty'), VERDICT_IDLE_MS);
  assert.equal(verdictQueueDelay('paused'), VERDICT_IDLE_MS);
  assert.equal(verdictQueueDelay('unconfigured'), VERDICT_IDLE_MS);
  assert.equal(verdictQueueDelay('cooldown', 12_000), 12_000);
});

test('composeVerdictQueueNote explains pending vs cooling vs empty', () => {
  assert.equal(composeVerdictQueueNote({
    enabled: false, pending: 10, due: 4, status: 'paused', storedNote: '',
  }), '自动智析已关');
  assert.equal(composeVerdictQueueNote({
    enabled: true, pending: 0, due: 0, status: 'idle', storedNote: '',
  }), '队列已清空');
  assert.equal(composeVerdictQueueNote({
    enabled: true, pending: 296, due: 0, status: 'idle', storedNote: '',
  }), '待补 296 份，失败后冷却中，稍后自动重试');
  assert.match(composeVerdictQueueNote({
    enabled: true, pending: 296, due: 12, status: 'idle', storedNote: '',
  }), /待补 296 份/);
  assert.equal(composeVerdictQueueNote({
    enabled: true, pending: 3, due: 1, status: 'running', storedNote: '正在智析 立讯精密',
  }), '正在智析 立讯精密');
});
