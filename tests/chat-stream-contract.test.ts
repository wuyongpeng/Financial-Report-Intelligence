import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAnswer, parseSse, validateCitations, type AnswerEvent } from '../lib/answer';
import type { RagContext } from '../lib/rag';

const context: RagContext = {
  question: '净利润为什么变化？',
  retrievalQuestion: '净利润变化原因',
  structuredContext: '净利润：10【E1】',
  evidence: [
    { id: 'E1', reportId: 'report-1', companyName: '样本公司', period: '2026H1', page: 8, quote: '净利润增加' },
  ],
  passages: [
    { id: 'E1', reportId: 'report-1', companyName: '样本公司', period: '2026H1', page: 8, quote: '净利润增加', content: '净利润增加的主要原因是主营业务改善。' },
  ],
  fallback: '净利润增加【E1】',
  mode: 'evidence-retrieval',
  metrics: [],
  peers: [],
};

test('SSE parser accepts LF, CRLF, multiple events, split events, and a final event without delimiter', () => {
  const combined = parseSse('data: {"content":"一"}\n\ndata: {"content":"二"}\r\n\r\n');
  assert.deepEqual(combined.events, ['{"content":"一"}', '{"content":"二"}']);
  assert.equal(combined.rest, '');

  const first = parseSse('data: {"content":"拆');
  assert.deepEqual(first.events, []);
  const second = parseSse(`${first.rest}分"}\n\ndata: [DONE]`, true);
  assert.deepEqual(second.events, ['{"content":"拆分"}', '[DONE]']);
});

test('streamed model output emits deltas and returns a grounded final result', async t => {
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const previousModel = process.env.LLM_MODEL;
  process.env.LLM_BASE_URL = 'http://model.test/v1';
  process.env.LLM_MODEL = 'contract-model';
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = previousModel;
  });

  const upstream = [
    'data: {"choices":[{"delta":{"reasoning_content":"分析"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"净利润增加"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"【E1】"},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ];
  t.mock.method(globalThis, 'fetch', async () => new Response(upstream.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
  const events: AnswerEvent[] = [];
  const result = await generateAnswer(context, [], new AbortController().signal, event => events.push(event));
  assert.equal(result.status, 'complete');
  assert.equal(result.mode, 'llm-rag');
  assert.equal(result.answer, '净利润增加【E1】');
  assert.deepEqual(result.evidence.map(item => item.id), ['E1']);
  assert.ok(events.some(event => event.status === 'reasoning'));
  assert.equal(events.map(event => event.content ?? '').join(''), '净利润增加【E1】');
});

test('unknown or missing stream citations fall back to server evidence', async t => {
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const previousModel = process.env.LLM_MODEL;
  process.env.LLM_BASE_URL = 'http://model.test/v1';
  process.env.LLM_MODEL = 'contract-model';
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = previousModel;
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '没有有效证据【E99】' }, finish_reason: 'stop' }],
  }));
  const result = await generateAnswer(context, [], new AbortController().signal);
  assert.equal(result.answer, context.fallback);
  assert.ok(result.warnings?.includes('citation-validation-failed'));
  assert.deepEqual(validateCitations('有效【E1】，无效【E99】', context), {
    evidence: context.evidence,
    invalid: ['E99'],
  });
});

test('a broken partial stream is interrupted rather than reported complete', async t => {
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const previousModel = process.env.LLM_MODEL;
  process.env.LLM_BASE_URL = 'http://model.test/v1';
  process.env.LLM_MODEL = 'contract-model';
  t.after(() => {
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = previousModel;
  });
  t.mock.method(globalThis, 'fetch', async () => new Response(
    'data: {"choices":[{"delta":{"content":"部分回答【E1】"}}]}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  ));
  const result = await generateAnswer(context, [], new AbortController().signal, () => undefined);
  assert.equal(result.status, 'interrupted');
  assert.equal(result.mode, 'llm-interrupted');
  assert.match(result.answer, /未完整/);
});
