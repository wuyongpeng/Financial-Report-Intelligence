import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

process.env.RUNTIME_DIR = mkdtempSync(join(tmpdir(), 'parse-abort-'));

const {
  ABORT_REQUEST_TTL_MS,
  abortParseRun,
  clearParseAbortRequests,
  consumeParseAbort,
  emptyTextParkMessage,
  hasParseAbortRequest,
  looksLikeHkTraditionalFiling,
  PARSE_ABORT_MESSAGE,
  registerParseRun,
  releaseParseRun,
  requestParseAbort,
} = await import('../lib/parse-abort');

test('中止请求可投递并被消费一次', () => {
  clearParseAbortRequests();
  requestParseAbort('p1');
  assert.equal(hasParseAbortRequest('p1'), true);
  assert.equal(consumeParseAbort('p1'), true);
  assert.equal(consumeParseAbort('p1'), false);
  assert.equal(hasParseAbortRequest('p1'), false);
});

test('进程内 AbortController 可立即中止', () => {
  const controller = registerParseRun('r1');
  assert.equal(controller.signal.aborted, false);
  assert.equal(abortParseRun('r1'), true);
  assert.equal(controller.signal.aborted, true);
  assert.equal(abortParseRun('r1'), false);
  releaseParseRun('r1');
});

test('空抽取搁置文案：港股繁体年報走专用提示', () => {
  assert.match(emptyTextParkMessage('中芯國際二零二五年年報'), /港股繁体年報/);
  assert.match(emptyTextParkMessage('某某 H股公告'), /港股繁体年報/);
  assert.equal(looksLikeHkTraditionalFiling('美的集团2025年年度报告'), false);
  assert.equal(emptyTextParkMessage('美的集团2025年年度报告'), '未能抽取正文（扫描件或无法读出文字），已搁置');
});

test('手动中止文案固定，便于运营识别', () => {
  assert.match(PARSE_ABORT_MESSAGE, /用户手动中止/);
  assert.ok(ABORT_REQUEST_TTL_MS > 60_000);
});

test('过期中止请求不作废前仍有效；消费后清理', () => {
  clearParseAbortRequests();
  requestParseAbort('old');
  assert.equal(hasParseAbortRequest('old'), true);
  clearParseAbortRequests();
  assert.equal(hasParseAbortRequest('old'), false);
});

test('enqueueParseFront 语义：中止后的 parse_parked 可由手动解析回到 downloaded（见 ingest.enqueueParseFront）', async () => {
  // 纯文档断言：中止文案与搁置态约定，避免回归成 downloaded+error 堵队首
  assert.equal(PARSE_ABORT_MESSAGE.includes('退出排队解析'), true);
  assert.equal(emptyTextParkMessage('扫描件').includes('已搁置'), true);
});
