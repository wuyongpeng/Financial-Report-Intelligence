import assert from 'node:assert/strict';
import test from 'node:test';
import { requestReportVerdict } from '../lib/request-report-verdict';

const ready = {
  verdict: { label: '稳健增长', summary: '主营业务保持增长，盈利能力同步改善。' },
  changes: [],
  modules: [],
};

test('requestReportVerdict polls 202 then returns the ready payload', async () => {
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    n += 1;
    const url = String(input);
    assert.match(url, /\/api\/reports\/r1\/verdict$/);
    if (init?.method === 'POST') return new Response(JSON.stringify({ ok: true, status: 'pending' }), { status: 202 });
    if (n < 3) return new Response(JSON.stringify({ status: 'pending' }), { status: 202 });
    return new Response(JSON.stringify(ready), { status: 200 });
  }) as typeof fetch;
  try {
    const parsed = await requestReportVerdict('r1', { fill: true, pollMs: 10, timeoutMs: 1000 });
    assert.equal(parsed.verdict.label, '稳健增长');
    assert.ok(n >= 3);
  } finally {
    globalThis.fetch = orig;
  }
});

test('requestReportVerdict surfaces 503 errors without treating 202 as failure', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: '模型超时' }), { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => requestReportVerdict('r2', { pollMs: 10, timeoutMs: 200 }), /模型超时/);
  } finally {
    globalThis.fetch = orig;
  }
});
