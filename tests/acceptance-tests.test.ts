import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildAcceptanceConclusionPrompt, cleanAcceptanceConclusion } from '../lib/acceptance-conclusion';
import { ACCEPTANCE_STATUS_LABEL, acceptanceStatus, defaultRunTitle, runPhase, RUN_PHASE_ACTION } from '../lib/acceptance-tests';
import { ACCEPTANCE_TEMPLATE, acceptanceTemplateIds } from '../lib/acceptance-template';

const source = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('hidden acceptance page is not linked from the ops nav', async () => {
  const shell = await source('app/admin/_components/admin-shell.tsx');
  assert.doesNotMatch(shell, /\/admin\/tests/);
  assert.match(await source('app/admin/tests/page.tsx'), /TestsAdminClient/);
  assert.match(await source('lib/backend-schema.ts'), /CREATE TABLE IF NOT EXISTS acceptance_runs/);
  assert.match(await source('lib/backend-schema.ts'), /CREATE TABLE IF NOT EXISTS acceptance_run_items/);
  assert.match(await source('lib/backend-schema.ts'), /CREATE TABLE IF NOT EXISTS acceptance_seed/);
  assert.match(await source('lib/backend-schema.ts'), /ADD COLUMN IF NOT EXISTS conclusion/);
  assert.match(await source('app/api/admin/tests/route.ts'), /ensureAcceptanceTemplate\(\)/);
  assert.match(await source('lib/acceptance-template.ts'), /scrubDiscardPasswordInAcceptanceCopy/);
  assert.match(await source('app/api/admin/tests/route.ts'), /redactDiscardPasswordCopy/);
});

test('initial template keeps the workbook cases and can be trimmed', () => {
  const ids = acceptanceTemplateIds();
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['0.1', '0.4', 'A1', 'A6', 'A10', 'B1', 'B5', 'C1', 'D1', 'D9', 'D13', 'E1', 'E2', 'B16', 'D14']) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(ACCEPTANCE_TEMPLATE.length, 6);
  assert.ok(ACCEPTANCE_TEMPLATE.reduce((sum, group) => sum + group.cases.length, 0) >= 40);
  const joined = ACCEPTANCE_TEMPLATE.flatMap((group) => group.cases.flatMap((item) => [item.steps, item.expected])).join('\n');
  assert.match(joined, /600519/);
  assert.match(joined, /正确密码/);
  assert.doesNotMatch(joined, /EVA/);
  assert.match(joined, /大约 3 分钟没说话/);
  assert.doesNotMatch(joined, /大约 60 秒什么都不说/);
  assert.doesNotMatch(joined, /五页/);
});

test('a round is unstarted, in progress, or finished from how many rows are still untested', () => {
  assert.equal(runPhase({ total: 57, pending: 57 }), 'ready');
  assert.equal(runPhase({ total: 57, pending: 56 }), 'running');
  assert.equal(runPhase({ total: 57, pending: 0 }), 'done');
  assert.equal(RUN_PHASE_ACTION.ready, '开始测试');
  assert.equal(RUN_PHASE_ACTION.running, '继续测试');
  assert.equal(RUN_PHASE_ACTION.done, '查看');
});

test('conclusion prompt keeps each row result and strips a code fence', () => {
  const prompt = buildAcceptanceConclusionPrompt([
    { groupName: 'A.用户主路径', title: 'A6 可验证追问', status: 'fail', note: '表格挤成一段' },
    { groupName: 'B.实时语音', title: 'B1 实时对话', status: 'pending', note: '' },
  ]);
  assert.match(prompt, /\[未通过\] A\.用户主路径 \/ A6 可验证追问/);
  assert.match(prompt, /记录：表格挤成一段/);
  assert.match(prompt, /\[未测\] B\.实时语音/);
  assert.equal(cleanAcceptanceConclusion('```markdown\n这一轮未通过。\n```'), '这一轮未通过。');
});

test('run titles use Shanghai time', () => {
  assert.equal(defaultRunTitle(new Date('2026-11-10T03:14:00Z')), '11-10 11:14 测试');
  assert.equal(acceptanceStatus('pass'), 'pass');
  assert.equal(acceptanceStatus('skip'), null);
  assert.equal(ACCEPTANCE_STATUS_LABEL.blocked, '阻塞');
});

test('deleting a test run rejects a missing or wrong password before any database call', async () => {
  const route = await source('app/api/admin/tests/route.ts');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.ok(post.indexOf('matchesDiscardPassword(body.password)') < post.indexOf('ensureBackendSchema()'));
  assert.doesNotMatch(await source('app/admin/tests/tests-client.tsx'), /DISCARD_CONFIRM_PASSWORD|from ['"].*discard-password/);
  const { POST } = await import('../app/api/admin/tests/route');
  for (const payload of [{ op: 'run.delete', id: 1 }, { op: 'run.delete', id: 1, password: 'eva' }]) {
    const response = await POST(new Request('http://localhost/api/admin/tests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 403);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, '删除密码错误');
  }
  const invalid = await POST(new Request('http://localhost/api/admin/tests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'nope' }),
  }));
  assert.equal(invalid.status, 400);
});
