import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as postChat } from '../app/api/chat/route';
import { apiError, ApiError, readObject, requiredText, uuid } from '../lib/api';
import { rankEvidence } from '../lib/chat-evidence';
import { mentionedCompanyCodes, retrievalQuestion, wantsCompanyHistory, wantsPeerCompare } from '../lib/rag';

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function post(body: unknown) {
  return postChat(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

test('API errors keep their public status, shape, and no-store policy', async t => {
  const expected = apiError(new ApiError(409, '资源冲突'));
  assert.equal(expected.status, 409);
  assert.equal(expected.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await json(expected), { error: '资源冲突' });

  t.mock.method(console, 'error', () => undefined);
  const internal = apiError(new Error('postgresql://user:secret@database/private'));
  assert.equal(internal.status, 503);
  assert.equal(internal.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await json(internal), { error: '服务暂时不可用，请稍后重试。' });
});

test('JSON body and primitive validators preserve boundary behavior', async () => {
  const request = (body: string) => new Request('http://localhost/api/test', { method: 'POST', body });
  await assert.rejects(readObject(request('bad')), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(readObject(request('[]')), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(readObject(request(`{"value":"${'x'.repeat(20_000)}"}`)), (error: unknown) => error instanceof ApiError && error.status === 413);
  assert.equal(requiredText('  财报问题  ', 'question'), '财报问题');
  assert.throws(() => requiredText('', 'question'), (error: unknown) => error instanceof ApiError && error.status === 400);
  assert.equal(uuid('550e8400-e29b-41d4-a716-446655440000', 'id'), '550e8400-e29b-41d4-a716-446655440000');
  assert.throws(() => uuid('not-a-uuid', 'id'), (error: unknown) => error instanceof ApiError && error.status === 400);
});

test('chat rejects malformed contracts before database or model work', async () => {
  const cases: Array<{ body: unknown; message: RegExp }> = [
    { body: {}, message: /reportId/ },
    { body: { reportId: 'report-1' }, message: /question/ },
    { body: { reportId: 'report-1', question: '问题', stream: 'yes' }, message: /stream/ },
    { body: { reportId: 'report-1', question: '问题', summary: 1 }, message: /summary/ },
    { body: { reportId: 'report-1', question: '问题', requestId: 'bad' }, message: /requestId/ },
    { body: { reportId: 'report-1', question: '问题', conversationId: 'bad' }, message: /conversationId/ },
  ];
  for (const item of cases) {
    const response = await post(item.body);
    assert.equal(response.status, 400);
    assert.match(String((await json(response)).error), item.message);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('current retrieval intent and keyword ranking behavior is locked as a refactor baseline', () => {
  const history = [
    { role: 'user' as const, content: '净利润为什么下降？' },
    { role: 'assistant' as const, content: '需要查看经营原因。' },
  ];
  assert.match(retrievalQuestion('具体原因呢？', history), /净利润为什么下降/);
  assert.equal(retrievalQuestion('营业收入是多少？', history), '营业收入是多少？');
  assert.equal(wantsCompanyHistory('过去三年现金流趋势'), true);
  assert.equal(wantsPeerCompare('与同行相比如何'), true);
  assert.deepEqual(mentionedCompanyCodes('对比格力电器', [
    { code: '000333', company_name: '美的集团' },
    { code: '000651', company_name: '格力电器' },
  ], '000333'), ['000651']);

  const ranked = rankEvidence('营业收入为什么变化', [
    { page: 1, content: '公司基本情况。' },
    { page: 8, content: '管理层讨论与分析：营业收入变化的主要原因是产品结构调整。' },
    { page: 20, content: '营业收入为一百万元。' },
  ], [20]);
  // Current heuristic gives a metric source page (+35) precedence over an
  // explanatory management passage. This intentionally locks the baseline;
  // later retrieval improvements may change it together with their evaluation.
  assert.equal(ranked[0]?.page, 20);
  assert.equal(ranked[1]?.page, 8);
  assert.ok(ranked.every(item => item.page !== 1));
  assert.deepEqual(rankEvidence('请看第 20 页', [
    { page: 8, content: '第八页内容' },
    { page: 20, content: '第二十页内容' },
  ]), [{ page: 20, content: '第二十页内容' }]);
});
