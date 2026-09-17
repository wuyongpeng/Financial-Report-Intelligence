import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERDICT_BUSY_MS,
  VERDICT_CALL_TIMEOUT_MS,
  VERDICT_CIRCUIT_FAILURES,
  VERDICT_IDLE_MS,
  VERDICT_LOCK_WAIT_MS,
  VERDICT_PAUSE_MS,
  verdictQueueDelay,
} from '../lib/verdict-queue';

test('auto verdict budget is slower than one minute and still bounded', () => {
  assert.equal(VERDICT_CALL_TIMEOUT_MS, 90_000);
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
