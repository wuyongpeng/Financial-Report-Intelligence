import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VERDICT_BUSY_MS,
  VERDICT_CALL_TIMEOUT_MS,
  VERDICT_CIRCUIT_FAILURES,
  VERDICT_IDLE_MS,
  VERDICT_LOCK_WAIT_MS,
  VERDICT_PAUSE_MS,
  VERDICT_WINDOW_FAIL_RATE,
  VERDICT_WINDOW_MIN_SAMPLES,
  VERDICT_WINDOW_SIZE,
  composeVerdictQueueNote,
  pruneStuckRunning,
  pushVerdictWindow,
  shouldOpenVerdictCircuit,
  verdictQueueDelay,
  verdictWindowFailRate,
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

test('槽位繁忙的提示不再一概怪问答（问答已有独立槽）', () => {
  const note = composeVerdictQueueNote({
    enabled: true, pending: 5, due: 5, status: 'waiting_llm', storedNote: '',
  });
  assert.match(note, /模型槽位繁忙/);
  assert.ok(!note.includes('问答占用'), '有独立问答槽后，busy 多是智析槽满或供应商限流');
});

test('中止后立刻补位，不等 15 秒的常规间隔', () => {
  assert.equal(verdictQueueDelay('aborted'), 1_000);
  assert.ok(verdictQueueDelay('aborted') < VERDICT_PAUSE_MS);
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

test('note 里带上并发数和已跳过份数，让中止有确定性反馈', () => {
  assert.match(composeVerdictQueueNote({
    enabled: true, pending: 473, due: 12, status: 'idle', storedNote: '', limit: 3,
  }), /并发 3 补齐/);
  // 默认并发 1 时不能自称「并发 1」，那会让人以为开了并发
  assert.match(composeVerdictQueueNote({
    enabled: true, pending: 473, due: 12, status: 'idle', storedNote: '', limit: 1,
  }), /单线程补齐/);
  assert.match(composeVerdictQueueNote({
    enabled: true, pending: 473, due: 12, status: 'idle', storedNote: '', limit: 3, skipped: 2,
  }), /已跳过 2 份可重新智析/);
  assert.match(composeVerdictQueueNote({
    enabled: true, pending: 0, due: 0, status: 'idle', storedNote: '', skipped: 5,
  }), /队列已清空 · 已跳过 5 份/);
});

test('滑动窗口只保留最近 N 次结果，newest last', () => {
  let window: Array<'ok' | 'fail'> = [];
  for (let i = 0; i < VERDICT_WINDOW_SIZE + 5; i++) window = pushVerdictWindow(window, 'ok');
  assert.equal(window.length, VERDICT_WINDOW_SIZE);
  window = pushVerdictWindow(window, 'fail');
  assert.equal(window.length, VERDICT_WINDOW_SIZE);
  assert.equal(window.at(-1), 'fail');
});

test('熔断按失败率而非连续次数：并发下 3 个同时失败不会立刻停队列', () => {
  // 并发 3 时一批同时失败，样本量不足，不能熔断
  assert.equal(shouldOpenVerdictCircuit(['fail', 'fail', 'fail']), false);
  assert.ok(VERDICT_WINDOW_MIN_SAMPLES > 3);
  // 样本足够但失败率不高 → 不熔断
  assert.equal(shouldOpenVerdictCircuit(['ok', 'ok', 'ok', 'ok', 'fail', 'fail']), false);
  // 持续高失败率 → 熔断
  assert.equal(shouldOpenVerdictCircuit(['fail', 'fail', 'fail', 'fail', 'fail', 'ok']), true);
  assert.equal(VERDICT_WINDOW_FAIL_RATE, 0.6);
});

test('verdictWindowFailRate 空窗口视为 0，不会误判', () => {
  assert.equal(verdictWindowFailRate([]), 0);
  assert.equal(verdictWindowFailRate(['fail', 'ok']), 0.5);
});

test('pruneStuckRunning 丢掉超时或缺失起始时间的幽灵任务', () => {
  const now = Date.parse('2026-09-18T06:00:00.000Z');
  const fresh = { id: 'a', code: '000001', name: '甲', period: '2025FY', title: 't', startedAt: new Date(now - 60_000).toISOString() };
  const stale = { ...fresh, id: 'b', startedAt: new Date(now - 11 * 60_000).toISOString() };
  const noStart = { ...fresh, id: 'c', startedAt: undefined };
  const alive = pruneStuckRunning([fresh, stale, noStart], now);
  assert.deepEqual(alive.map((item) => item.id), ['a']);
});
