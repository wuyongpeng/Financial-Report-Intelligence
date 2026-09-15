import assert from 'node:assert/strict';
import test from 'node:test';
import { appSessionOwner, createAppCookie, createDemoCookie } from '../lib/auth';
import { boundedMemory } from '../lib/conversations';
import { hasCoreMetrics } from '../lib/metric-quality';
import { buildOutline } from '../lib/outline';
import { excerpt, retrievalQuestion, type RagContext } from '../lib/rag';
import { generateAnswer, modelMessages, parseAnswerRewrite, parseSse, validateCitations } from '../lib/answer';
import { readObject } from '../lib/api';
import { collectPages } from '../lib/sources';
import type { Announcement } from '../lib/types';

test('completeness depends on names, not the number of extracted rows', () => {
  const core = ['revenue','net_profit','eps','roe'].map(metric => ({ metric, value: 1 }));
  assert.ok(hasCoreMetrics([...core, { metric: 'operating_cost', value: 3 }]));
  assert.equal(hasCoreMetrics([...core.slice(0, 3), { metric: 'operating_cost', value: 3 }]), false);
  assert.equal(hasCoreMetrics([...core.slice(0, 3), { metric: 'roe', value: NaN }]), false);
});

test('contents and cross-references cannot take precedence over section bodies', () => {
  const outline = buildOutline([
    { page: 2, content: '重要提示 本公司已在本报告中“管理层讨论与分析”章节阐述了风险。' },
    { page: 3, content: '目录 第三章 管理层讨论与分析 ........ 10 第八章 财务报表 .... 81' },
    { page: 11, content: '10 招商银行股份有限公司 第三章 管理层讨论与分析 2026年半年度报告 管理层讨论与分析 3.1 总体经营情况分析' },
  ]);
  assert.equal(outline.find(s => s.id === 'mda')?.page, 11);
  assert.ok(!outline.some(s => s.page === 3));
});

test('separate browser sessions do not share private memory', () => {
  process.env.APP_SESSION_SECRET = 'unit-test-secret-with-at-least-24-characters';
  process.env.APP_USERNAME = 'tester'; process.env.APP_DEMO_ACCESS = 'true';
  const request = (cookie: string) => new Request('http://localhost', { headers: { cookie: `fri_app_session=${cookie}` } });
  const a = request(createAppCookie('tester')), b = request(createAppCookie('tester'));
  assert.ok(appSessionOwner(a)); assert.notEqual(appSessionOwner(a), appSessionOwner(b));
  assert.notEqual(appSessionOwner(request(createDemoCookie())), appSessionOwner(request(createDemoCookie())));
  assert.equal(appSessionOwner(request(`${createAppCookie('tester')}tampered`)), null);
});

test('memory uses a bounded number of complete recent turns and resolves follow-ups', () => {
  const turns = Array.from({ length: 9 }, (_, i) => [{ role: 'user' as const, content: `净利润${i}是多少？` }, { role: 'assistant' as const, content: '旧答案' }]).flat();
  const memory = boundedMemory(turns);
  assert.equal(memory.length, 12); assert.match(memory[0].content, /3/);
  assert.match(retrievalQuestion('为什么？', memory), /净利润8/);
  assert.equal(retrievalQuestion('营业收入是多少？', memory), '营业收入是多少？');
  const content = `${'无关内容'.repeat(600)}营业收入变动原因是收入结构变化。${'尾部'.repeat(600)}`;
  assert.match(excerpt('营业收入变动原因', content, 160), /营业收入/);
});

test('SSE parser handles chunk boundaries and missing final delimiter', () => {
  const first = parseSse('data: {"content":"a"}\r');
  assert.deepEqual(first.events, []);
  const second = parseSse(first.rest + '\n\r\ndata: [DONE]', true);
  assert.deepEqual(second.events, ['{"content":"a"}', '[DONE]']);
});

const context: RagContext = {
  question: '为什么？', retrievalQuestion: '利润为什么变化', structuredContext: '利润=10',
  evidence: [{ id: 'E1', reportId: 'test', companyName: '样本', period: '2026H1', page: 2, quote: '净利润增加' }],
  passages: [], fallback: '原文：净利润增加【E1】', mode: 'evidence-retrieval', metrics: [], peers: [],
};

test('rewrite styles append targeted instructions', () => {
  assert.equal(parseAnswerRewrite('detailed'), 'detailed');
  assert.equal(parseAnswerRewrite('nope'), undefined);
  const detailed = modelMessages(context, [], 'detailed');
  const brief = modelMessages(context, [], 'brief');
  const retry = modelMessages(context, [], 'retry');
  const plain = modelMessages(context, []);
  assert.match(detailed[detailed.length - 1].content, /更详尽/);
  assert.match(brief[brief.length - 1].content, /更简短/);
  assert.match(retry[retry.length - 1].content, /重新作答/);
  assert.doesNotMatch(plain[plain.length - 1].content, /重写要求/);
});

test('deterministic answers avoid model calls; unknown citations trigger fallback', async t => {
  process.env.LLM_BASE_URL = 'http://model.invalid/v1'; process.env.LLM_MODEL = 'test';
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: '错误引用【E99】' } }] }));
  const signal = new AbortController().signal;
  const direct = await generateAnswer({ ...context, directAnswer: '利润：10【E1】', mode: 'structured-query' }, [], signal);
  assert.equal(direct.mode, 'structured-query'); assert.equal(fetch.mock.callCount(), 0);
  const fallback = await generateAnswer(context, [], signal);
  assert.equal(fallback.answer, context.fallback); assert.ok(fallback.warnings?.includes('citation-validation-failed'));
  assert.deepEqual(validateCitations('【E1】与【E99】', context).invalid, ['E99']);
});

test('model failure falls back, while a broken partial stream is not marked complete', async t => {
  process.env.LLM_BASE_URL = 'http://model.invalid/v1'; process.env.LLM_MODEL = 'test';
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const result = await generateAnswer(context, [], new AbortController().signal);
  assert.equal(result.answer, context.fallback); assert.ok(result.warnings?.includes('model-unavailable'));
  fetch.mock.mockImplementation(async () => new Response('data: {"choices":[{"delta":{"content":"部分回答【E1】"}}]}\n\n'));
  const partial = await generateAnswer(context, [], new AbortController().signal, () => undefined);
  assert.equal(partial.status, 'interrupted'); assert.match(partial.answer, /未完整/);
});

test('API rejects malformed and oversized JSON input', async () => {
  const req = (body: string) => new Request('http://localhost', { method: 'POST', body });
  await assert.rejects(readObject(req('null')), /JSON 对象/);
  await assert.rejects(readObject(req('bad')), /JSON/);
  await assert.rejects(readObject(req(' '.repeat(20_001))), /过长/);
});

test('source discovery traverses non-report pages and reports incomplete scans', async () => {
  const item: Announcement = { source: 'SSE', sourceId: 'id', code: '1', name: 'sample', title: '年报', publishedAt: '', pdfUrl: '', reportType: 'annual' };
  const seen: number[] = [];
  const result = await collectPages(async page => {
    seen.push(page);
    return page === 1 ? { items: [], rawCount: 200 } : page === 2 ? { items: [item], rawCount: 1 } : { items: [], rawCount: 0 };
  }, 5, 0);
  assert.deepEqual(seen, [1,2,3]); assert.equal(result.complete, true); assert.equal(result.items.length, 1);
  const capped = await collectPages(async () => ({ items: [], rawCount: 200 }), 2, 0);
  assert.equal(capped.complete, false);
  const failed = await collectPages(async page => { if (page === 2) throw new Error('offline'); return { items: [item], rawCount: 1 }; }, 5, 0);
  assert.equal(failed.complete, false); assert.equal(failed.items.length, 1);
});
