import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { extractProbeReply, fetchChatCompletions, isLlmSlotBusyError, laneSlots, LLM_INTERACTIVE_SLOT, llmRetryDelayMs, probeLlmProvider, probeLlmProviders, resetLlmProviderState, shouldFailoverLlmStatus, shouldRetryLlmStatus, withLlmSlot } from '../lib/llm-gate';

test('retries only HTTP 429', () => {
  assert.equal(shouldRetryLlmStatus(429), true);
  assert.equal(shouldRetryLlmStatus(503), false);
  assert.equal(shouldRetryLlmStatus(200), false);
  assert.equal(shouldRetryLlmStatus(400), false);
});

test('failovers on auth, timeout and 5xx, not on 400', () => {
  assert.equal(shouldFailoverLlmStatus(429), true);
  assert.equal(shouldFailoverLlmStatus(503), true);
  assert.equal(shouldFailoverLlmStatus(401), true);
  assert.equal(shouldFailoverLlmStatus(400), false);
  assert.equal(shouldFailoverLlmStatus(200), false);
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

test('问答永远独占 slot 0，不会被背景智析饿死', () => {
  assert.deepEqual(laneSlots('interactive', 4), [LLM_INTERACTIVE_SLOT]);
  assert.deepEqual(laneSlots('interactive', 1), [LLM_INTERACTIVE_SLOT]);
  // 并发 3 智析 => 总槽 4 => 背景占 1..3，绝不碰 slot 0
  assert.deepEqual(laneSlots('background', 4), [1, 2, 3]);
  assert.ok(!laneSlots('background', 4).includes(LLM_INTERACTIVE_SLOT));
});

test('单槽配置下 background 退回 slot 0，保持存量单并发语义', () => {
  assert.deepEqual(laneSlots('background', 1), [LLM_INTERACTIVE_SLOT]);
  assert.deepEqual(laneSlots('background'), [LLM_INTERACTIVE_SLOT]);
});

test('background 车道可真正并发，不被串行链抵消', async () => {
  process.env.LLM_GATE_FILE = join(mkdtempSync(join(tmpdir(), 'llm-gate-conc-')), 'gate.lock');
  let peak = 0;
  let active = 0;
  const run = () => withLlmSlot(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 40));
    active -= 1;
  }, undefined, undefined, { slots: 4, lane: 'background' });
  await Promise.all([run(), run(), run()]);
  assert.equal(peak, 3, '并发 3 应真正同时在跑');
});

test('background 并发不会占满问答的保留槽', async () => {
  process.env.LLM_GATE_FILE = join(mkdtempSync(join(tmpdir(), 'llm-gate-reserve-')), 'gate.lock');
  let chatRan = false;
  const holds = [0, 1, 2].map(() => withLlmSlot(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }, undefined, undefined, { slots: 4, lane: 'background' }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  // 3 个背景任务跑满 slot 1..3 时，问答仍能立刻拿到 slot 0
  await withLlmSlot(async () => { chatRan = true; }, undefined, 300);
  assert.equal(chatRan, true, '智析跑满时问答必须仍能立即执行');
  await Promise.all(holds);
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

test('withLlmSlot times out acquire quickly when asked not to wait', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'llm-gate-busy-'));
  const file = join(dir, 'gate.lock');
  process.env.LLM_GATE_FILE = file;
  writeFileSync(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`);
  await assert.rejects(
    () => withLlmSlot(async () => 'no', undefined, 200),
    (error: unknown) => isLlmSlotBusyError(error),
  );
});

function withLlmEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
  const keys = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_MODELS', 'LLM_PROVIDERS', 'LLM_FAILOVER_TIMEOUT_MS'];
  const prev = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  resetLlmProviderState();
  return fn().finally(() => {
    resetLlmProviderState();
    for (const key of keys) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });
}

test('fetchChatCompletions failovers from 502 to the next provider', async () => {
  await withLlmEnv({
    LLM_BASE_URL: 'http://a.invalid/v1',
    LLM_MODEL: 'model-a',
    LLM_PROVIDERS: JSON.stringify([{ name: 'b', baseUrl: 'http://b.invalid/v1', model: 'model-b' }]),
  }, async () => {
    const orig = globalThis.fetch;
    const hits: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      hits.push(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      if (url.includes('a.invalid')) return new Response('down', { status: 502 });
      assert.equal(body.model, 'model-b');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const res = await fetchChatCompletions({ messages: [] });
      assert.equal(res.status, 200);
      assert.deepEqual(hits, ['http://a.invalid/v1/chat/completions', 'http://b.invalid/v1/chat/completions']);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

test('fetchChatCompletions does not failover on HTTP 400', async () => {
  await withLlmEnv({
    LLM_BASE_URL: 'http://a.invalid/v1',
    LLM_MODEL: 'model-a',
    LLM_PROVIDERS: JSON.stringify([{ name: 'b', baseUrl: 'http://b.invalid/v1', model: 'model-b' }]),
  }, async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('bad', { status: 400 });
    }) as typeof fetch;
    try {
      const res = await fetchChatCompletions({ messages: [] });
      assert.equal(res.status, 400);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

test('extractProbeReply treats reasoning and think-only payloads as connected', () => {
  assert.deepEqual(extractProbeReply(JSON.stringify({
    choices: [{ message: { content: '', reasoning_content: '用户只要 ok' } }],
  })), { connected: true, reply: '' });
  assert.deepEqual(extractProbeReply(JSON.stringify({
    choices: [{ message: { content: '<think>先想一下</think>\nok' } }],
  })), { connected: true, reply: 'ok' });
  assert.deepEqual(extractProbeReply(JSON.stringify({
    choices: [{ message: { content: '<think> 用户只是说直接回复ok' } }],
  })), { connected: true, reply: '' });
  assert.deepEqual(extractProbeReply(JSON.stringify({
    choices: [{ message: { content: [{ type: 'text', text: 'ok' }] } }],
  })), { connected: true, reply: 'ok' });
  assert.deepEqual(extractProbeReply(JSON.stringify({
    choices: [{ message: { content: '' } }],
  })), { connected: false, reply: '' });
});

test('probeLlmProvider reports ok reply and HTTP errors without retrying', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const ok = await probeLlmProvider({
      id: 'primary',
      baseUrl: 'http://ok.invalid/v1',
      model: 'm1',
    }, 2_000);
    assert.equal(ok.ok, true);
    assert.equal(ok.reply, 'ok');
    assert.equal(ok.host, 'ok.invalid');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }

  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({
      choices: [{ message: { content: '', reasoning_content: '先分析指令' } }],
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const reasoned = await probeLlmProvider({
      id: 'primary',
      baseUrl: 'http://ok.invalid/v1',
      model: 'm1',
    }, 2_000);
    assert.equal(reasoned.ok, true);
    assert.equal(reasoned.reply, undefined);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }

  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response('{"error":{"message":"no quota"}}', { status: 429 });
  }) as typeof fetch;
  try {
    const bad = await probeLlmProvider({
      id: 'fallback',
      baseUrl: 'http://fail.invalid/v1',
      model: 'm2',
    }, 2_000);
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? '', /429/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test('probeLlmProviders pings models in parallel', async () => {
  await withLlmEnv({
    LLM_BASE_URL: 'http://gw.invalid/v1',
    LLM_API_KEY: 'k',
    LLM_MODEL: 'm1',
    LLM_MODELS: 'm1,m2',
  }, async () => {
    const orig = globalThis.fetch;
    let inflight = 0;
    let maxInflight = 0;
    globalThis.fetch = (async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 40));
      inflight -= 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    }) as typeof fetch;
    try {
      const results = await probeLlmProviders(500);
      assert.equal(results.length, 2);
      assert.ok(results.every((item) => item.ok));
      assert.equal(maxInflight, 2);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
