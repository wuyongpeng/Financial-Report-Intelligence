// Local database/API integration only. Model calls are disabled in this process;
// no financial data is sent to an external service and no report data is edited.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../lib/db';
import { appSessionOwner, createAppCookie } from '../lib/auth';
import { beginTurn, finishTurn } from '../lib/conversations';
import { POST as chat } from '../app/api/chat/route';
import { GET as list, POST as create } from '../app/api/conversations/route';
import { GET as read, DELETE as remove } from '../app/api/conversations/[id]/route';
import { GET as reports } from '../app/api/reports/route';
import { GET as status } from '../app/api/status/route';
import { GET as health } from '../app/api/health/route';
import { GET as reportStatus } from '../app/api/reports/[id]/status/route';

process.env.LLM_BASE_URL = ''; process.env.LLM_MODEL = ''; process.env.LLM_API_KEY = '';
process.env.APP_USERNAME = 'backend-smoke';
process.env.APP_SESSION_SECRET = 'backend-smoke-local-only-session-secret';

async function main() {
  const db = getDb();
  const [report] = await db<Array<{ id: string; value: number }>>`SELECT a.id, m.value FROM announcements a
    JOIN financial_metrics m ON m.announcement_id=a.id AND m.metric='revenue'
    WHERE (SELECT COUNT(*) FROM financial_metrics f WHERE f.announcement_id=a.id AND f.metric IN ('revenue','net_profit','eps','roe'))=4
    ORDER BY a.published_at DESC LIMIT 1`;
  assert.ok(report, 'Import at least one real, core-complete report first');
  const cookie = createAppCookie('backend-smoke'), otherCookie = createAppCookie('backend-smoke');
  const request = (path: string, body?: unknown, session = cookie, method = body === undefined ? 'GET' : 'POST') => new Request(`http://localhost${path}`, {
    method, headers: { cookie: `fri_app_session=${session}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const owner = appSessionOwner(request('/'))!;
  let id: string | undefined;
  try {
    assert.equal((await health()).status, 200);
    const coverage = await (await status(request('/api/status'))).json();
    assert.ok(coverage.coverage > 0); assert.ok(coverage.coverage <= coverage.targetCoverage);
    const listing = await (await reports(request('/api/reports?view=companies&limit=100'))).json();
    assert.ok(listing.reports?.some((r: { id: string }) => r.id === report.id));
    const stage = await reportStatus(request('/'), { params: Promise.resolve({ id: report.id }) });
    assert.equal(stage.status, 200); assert.equal((await stage.json()).timeline.length, 5);
    console.log('PASS health, real coverage, company report listing, source timeline');

    const created = await create(request('/api/conversations', { reportId: report.id }));
    assert.equal(created.status, 201);
    id = (await created.json()).conversation.id;
    assert.ok(id);
    const params = { params: Promise.resolve({ id }) };
    assert.equal((await read(request('/', undefined, otherCookie), params)).status, 404);
    assert.equal((await read(new Request('http://localhost'), params)).status, 401);
    assert.equal((await remove(request('/', undefined, otherCookie, 'DELETE'), params)).status, 404);
    const requestId = randomUUID();
    const body = { reportId: report.id, conversationId: id, requestId, question: '营业收入是多少？' };
    const response = await chat(request('/api/chat', body));
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.mode, 'structured-query'); assert.equal(answer.status, 'complete');
    assert.ok(answer.answer.includes(String(report.value)));
    assert.ok(answer.evidence.every((e: { reportId: string }) => e.reportId === report.id));
    const replay = await (await chat(request('/api/chat', body))).json();
    assert.equal(replay.answer, answer.answer);
    const saved = await (await read(request('/'), params)).json();
    assert.equal(saved.messages.length, 2); assert.equal(saved.messages[1].content, answer.answer);
    assert.equal((await chat(request('/api/chat', { ...body, question: '其他问题' }))).status, 409);
    assert.equal((await chat(request('/api/chat', { ...body, reportId: 'wrong-report', requestId: randomUUID() }))).status, 409);
    console.log('PASS isolated sessions, persisted answers, idempotency, report scope');

    const next = randomUUID();
    const turn = await beginTurn(owner, id, report.id, next, '为什么？');
    assert.equal(turn.history.length, 2); assert.equal(turn.history[0].content, body.question);
    await assert.rejects(beginTurn(owner, id, report.id, randomUUID(), '并发问题'), /正在回答/);
    await finishTurn(owner, id, next, { answer: '已取消', status: 'interrupted', mode: 'cancelled', evidence: [], durationMs: 1 });
    const stream = await chat(request('/api/chat', { ...body, requestId: randomUUID(), question: '基本每股收益是多少？', stream: true }));
    assert.equal(stream.status, 200);
    const events = await stream.text();
    assert.match(events, /\[DONE\]/); assert.match(events, /"result"/); assert.match(events, /"status":"complete"/);
    const recovered = await (await read(request('/'), params)).json();
    assert.equal(recovered.messages.length, 6);
    const unknown = await (await chat(request('/api/chat', { reportId: report.id, question: '2099年的营业收入是多少？' }))).json();
    assert.equal(unknown.mode, 'out-of-scope');
    const listing2 = await (await list(request(`/api/conversations?reportId=${encodeURIComponent(report.id)}`))).json();
    assert.ok(listing2.conversations.some((c: { id: string }) => c.id === id));
    console.log('PASS bounded history, concurrent turn rejection, cancellation, SSE, unknown year');
    assert.equal((await remove(request('/', undefined, cookie, 'DELETE'), params)).status, 200);
    assert.equal((await read(request('/'), params)).status, 404);
    console.log('PASS conversation deletion; no external model calls');
  } finally {
    // Only delete this test's synthetic conversations, never existing users'.
    if (id) await db`DELETE FROM chat_conversations WHERE id=${id} AND owner_key=${owner}`;
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : 'Backend test failed'); process.exitCode = 1; }).finally(() => closeDb());
