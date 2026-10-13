import assert from 'node:assert/strict';

const configuredBaseUrl = process.env.API_BASE_URL?.trim();
const baseUrl = (configuredBaseUrl || 'http://localhost:3000').replace(/\/$/, '');
if (configuredBaseUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configuredBaseUrl)) {
  throw new Error('安全限制：API_BASE_URL 只能指向 localhost 或 127.0.0.1');
}

type JsonObject = Record<string, unknown>;
type Check = { name: string; run: () => Promise<void> };

let cookie = '';
let reportId = '';
let conversationId = '';

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
  return response;
}

async function readJson(response: Response): Promise<JsonObject> {
  const type = response.headers.get('content-type') ?? '';
  assert.match(type, /application\/json/i, `expected JSON content-type, received ${type || '(missing)'}`);
  return response.json() as Promise<JsonObject>;
}

function assertNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /no-store/i);
}

function assertRecord(value: unknown, name: string): asserts value is JsonObject {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
}

const checks: Check[] = [
  {
    name: 'health endpoint reports a connected initialized database',
    async run() {
      const response = await request('/api/health');
      assert.equal(response.status, 200);
      assertNoStore(response);
      const body = await readJson(response);
      assert.equal(body.status, 'ok');
      assert.equal(body.database, 'connected');
      assert.equal(typeof body.version, 'string');
      assert.equal(JSON.stringify(body).includes('DATABASE_URL'), false);
      assert.equal(JSON.stringify(body).includes('postgresql://'), false);
    },
  },
  {
    name: 'reports endpoint keeps success and validation contracts',
    async run() {
      const invalidLimits = ['0', '-1', 'abc'];
      for (const limit of invalidLimits) {
        const invalid = await request(`/api/reports?limit=${encodeURIComponent(limit)}`);
        assert.equal(invalid.status, 400, `limit=${limit}`);
        assertNoStore(invalid);
        assert.equal(typeof (await readJson(invalid)).error, 'string');
      }

      const response = await request('/api/reports?limit=1');
      assert.equal(response.status, 200);
      assertNoStore(response);
      const body = await readJson(response);
      assert.equal(typeof body.count, 'number');
      assert.ok(Array.isArray(body.reports));
      assert.equal(body.count, body.reports.length);
      assert.ok(body.reports.length > 0, '本地数据库没有报告，无法建立报告详情契约基线');
      const report = body.reports[0];
      assertRecord(report, 'report');
      for (const field of ['id', 'code', 'company_name', 'title', 'report_type']) {
        assert.equal(typeof report[field], 'string', `report.${field}`);
      }
      assert.ok(Array.isArray(report.metrics), 'report.metrics must be an array');
      for (const metric of report.metrics) {
        assertRecord(metric, 'metric');
        assert.equal(typeof metric.metric, 'string');
        assert.equal(typeof metric.value, 'number');
        assert.equal(typeof metric.unit, 'string');
        assert.equal(typeof metric.period, 'string');
      }
      reportId = String(report.id);
    },
  },
  {
    name: 'report detail endpoints keep their public shape',
    async run() {
      assert.ok(reportId, 'reports check must run first');
      const outline = await request(`/api/reports/${encodeURIComponent(reportId)}/outline`);
      assert.equal(outline.status, 200);
      assertNoStore(outline);
      const outlineBody = await readJson(outline);
      assert.equal(outlineBody.source, 'parsed_pdf_text');
      assert.equal(typeof outlineBody.indexedPages, 'number');
      assert.ok(Array.isArray(outlineBody.outline));
      assert.ok(Array.isArray(outlineBody.pages));

      const analysis = await request(`/api/reports/${encodeURIComponent(reportId)}/analysis`);
      assert.equal(analysis.status, 200);
      assertNoStore(analysis);
      const analysisBody = await readJson(analysis);
      assert.ok(Array.isArray(analysisBody.peers));
      assert.ok(Array.isArray(analysisBody.anomalies));
      assert.equal(typeof analysisBody.basis, 'string');

      const missing = await request('/api/reports/__contract_missing_report__/analysis');
      assert.equal(missing.status, 404);
      assert.equal(typeof (await readJson(missing)).error, 'string');
    },
  },
  {
    name: 'conversation lifecycle preserves ownership and deletion',
    async run() {
      assert.ok(reportId, 'reports check must run first');
      const created = await request('/api/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId }),
      });
      assert.equal(created.status, 201);
      assertNoStore(created);
      const createdBody = await readJson(created);
      assertRecord(createdBody.conversation, 'conversation');
      assert.equal(typeof createdBody.conversation.id, 'string');
      assert.equal(createdBody.conversation.report_id, reportId);
      conversationId = String(createdBody.conversation.id);

      const listed = await request(`/api/conversations?reportId=${encodeURIComponent(reportId)}`);
      assert.equal(listed.status, 200);
      assert.ok(Array.isArray((await readJson(listed)).conversations));

      const read = await request(`/api/conversations/${encodeURIComponent(conversationId)}`);
      assert.equal(read.status, 200);
      const readBody = await readJson(read);
      assertRecord(readBody.conversation, 'conversation');
      assert.ok(Array.isArray(readBody.messages));

      const foreign = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conversationId)}`, { redirect: 'manual' });
      assert.equal(foreign.status, 404);

      const deleted = await request(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
      assert.equal(deleted.status, 200);
      assert.deepEqual(await readJson(deleted), { ok: true });
      conversationId = '';

      const reread = await request(`/api/conversations/${encodeURIComponent(String(createdBody.conversation.id))}`);
      assert.equal(reread.status, 404);
    },
  },
  {
    name: 'chat rejects invalid input without invoking retrieval',
    async run() {
      const response = await request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId, question: '问题', stream: 'yes' }),
      });
      assert.equal(response.status, 400);
      assertNoStore(response);
      assert.match(String((await readJson(response)).error), /stream/);
    },
  },
  {
    name: 'chat stream keeps the SSE event and completion contract',
    async run() {
      const response = await request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportId, question: '明天股价会涨还是跌？', stream: true }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/i);
      assert.match(response.headers.get('cache-control') ?? '', /no-cache/i);
      const text = await response.text();
      const events = text.replace(/\r\n/g, '\n').split('\n\n')
        .map(block => block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean);
      assert.equal(events.at(-1), '[DONE]');
      const payloads = events.slice(0, -1).map(event => JSON.parse(event) as JsonObject);
      assert.ok(payloads.some(event => event.status === 'retrieving'));
      const final = payloads.find(event => event.result);
      assert.ok(final, 'missing final result event');
      assertRecord(final.result, 'chat result');
      assert.equal(typeof final.result.answer, 'string');
      assert.equal(final.result.status, 'complete');
      assert.equal(final.result.mode, 'out-of-scope');
      assert.ok(Array.isArray(final.result.evidence));
    },
  },
];

async function cleanup() {
  if (!conversationId) return;
  await request(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' }).catch(() => undefined);
}

async function main() {
  console.log(`API contract target: ${baseUrl}`);
  let passed = 0;
  try {
    for (const check of checks) {
      try {
        await check.run();
        passed += 1;
        console.log(`✓ ${check.name}`);
      } catch (error) {
        console.error(`✗ ${check.name}`);
        throw error;
      }
    }
  } finally {
    await cleanup();
  }
  console.log(`API contract checks passed: ${passed}/${checks.length}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
