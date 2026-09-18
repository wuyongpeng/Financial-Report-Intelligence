import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/** Each test gets its own RUNTIME_DIR so the JSON stores never leak between cases. */
function freshRuntime() {
  process.env.RUNTIME_DIR = mkdtempSync(join(tmpdir(), 'verdict-abort-'));
}

const {
  ABORT_REQUEST_TTL_MS,
  abortVerdictRun,
  clearAllVerdictSkips,
  clearVerdictSkip,
  consumeVerdictAbort,
  countVerdictSkips,
  hasVerdictAbortRequest,
  isVerdictSkipped,
  listVerdictSkips,
  markVerdictSkipped,
  registerVerdictRun,
  releaseVerdictRun,
  requestVerdictAbort,
  skippedVerdictIds,
} = await import('../lib/verdict-abort');

test('中止请求可跨进程投递，被消费一次后不再重复触发', () => {
  freshRuntime();
  requestVerdictAbort('a1');
  assert.equal(hasVerdictAbortRequest('a1'), true);
  assert.equal(consumeVerdictAbort('a1'), true);
  assert.equal(consumeVerdictAbort('a1'), false, '消费后不应重复中止后来的任务');
  assert.equal(hasVerdictAbortRequest('a1'), false);
});

test('过期的中止请求作废，不会误杀后续任务', () => {
  freshRuntime();
  requestVerdictAbort('a2');
  const later = Date.now() + ABORT_REQUEST_TTL_MS + 1_000;
  assert.equal(hasVerdictAbortRequest('a2', later), false);
  assert.equal(consumeVerdictAbort('a2', later), false);
});

test('空 id 不入队，避免污染中止队列', () => {
  freshRuntime();
  requestVerdictAbort('   ');
  assert.equal(hasVerdictAbortRequest(''), false);
});

test('同进程注册表可立即 abort 正在跑的任务', () => {
  freshRuntime();
  const controller = registerVerdictRun('r1');
  assert.equal(controller.signal.aborted, false);
  assert.equal(abortVerdictRun('r1'), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(abortVerdictRun('r1'), false, '已 abort 的不应重复返回 true');
  releaseVerdictRun('r1');
  assert.equal(abortVerdictRun('r1'), false);
});

test('中止必须落 skip 标记，否则下一 tick 会被重新领取', () => {
  freshRuntime();
  markVerdictSkipped('s1', { reason: '用户手动中止', elapsedMs: 4200 });
  assert.equal(isVerdictSkipped('s1'), true);
  assert.equal(countVerdictSkips(), 1);
  const [entry] = listVerdictSkips();
  assert.equal(entry.id, 's1');
  assert.equal(entry.reason, '用户手动中止');
  assert.equal(entry.elapsedMs, 4200);
  assert.ok(skippedVerdictIds().has('s1'));
});

test('重复中止同一份不产生重复记录', () => {
  freshRuntime();
  markVerdictSkipped('s2');
  markVerdictSkipped('s2');
  assert.equal(countVerdictSkips(), 1);
});

test('「重新智析」撤销跳过标记后才会回到队列', () => {
  freshRuntime();
  markVerdictSkipped('s3');
  assert.equal(clearVerdictSkip('s3'), true);
  assert.equal(isVerdictSkipped('s3'), false);
  assert.equal(clearVerdictSkip('s3'), false, '不存在的标记应返回 false');
});

test('全部重新智析返回恢复份数', () => {
  freshRuntime();
  markVerdictSkipped('s4');
  markVerdictSkipped('s5');
  assert.equal(clearAllVerdictSkips(), 2);
  assert.equal(countVerdictSkips(), 0);
});
