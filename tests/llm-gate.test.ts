import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { llmRetryDelayMs, shouldRetryLlmStatus, withLlmSlot } from '../lib/llm-gate';

test('retries only HTTP 429', () => {
  assert.equal(shouldRetryLlmStatus(429), true);
  assert.equal(shouldRetryLlmStatus(503), false);
  assert.equal(shouldRetryLlmStatus(200), false);
  assert.equal(shouldRetryLlmStatus(400), false);
});

test('backoff honors Retry-After seconds and exponential fallback', () => {
  assert.equal(llmRetryDelayMs(0, '3'), 3000);
  assert.equal(llmRetryDelayMs(0, '120'), 60_000);
  assert.equal(llmRetryDelayMs(0, null), 2000);
  assert.equal(llmRetryDelayMs(3, undefined), 16_000);
  const until = Date.parse('2026-09-17T00:00:10.000Z');
  assert.equal(llmRetryDelayMs(0, 'Thu, 17 Sep 2026 00:00:10 GMT', Date.parse('2026-09-17T00:00:00.000Z')), 10_000);
  assert.ok(until > 0);
});

test('withLlmSlot runs overlapping work one at a time', async () => {
  process.env.LLM_GATE_FILE = join(mkdtempSync(join(tmpdir(), 'llm-gate-')), 'gate.lock');
  const order: number[] = [];
  await Promise.all([
    withLlmSlot(async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 40));
      order.push(2);
    }),
    withLlmSlot(async () => {
      order.push(3);
      order.push(4);
    }),
  ]);
  assert.deepEqual(order, [1, 2, 3, 4]);
});

test('withLlmSlot reclaims a stale lock from a dead pid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-gate-stale-'));
  const file = join(dir, 'gate.lock');
  process.env.LLM_GATE_FILE = file;
  writeFileSync(file, `${JSON.stringify({ pid: 999999, at: Date.now() - 4 * 60 * 1000 })}\n`);
  const seen = await withLlmSlot(async () => 'ok');
  assert.equal(seen, 'ok');
});
