import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { adminSourcesTarget } from '../lib/admin-route';

const source = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('admin sources redirects preserve focus and arbitrary repeated query values', () => {
  assert.equal(adminSourcesTarget(), '/admin/sources');
  assert.equal(adminSourcesTarget({ focus: '605499', tag: ['a', 'b'], empty: '', skip: undefined }),
    '/admin/sources?focus=605499&tag=a&tag=b&empty=');
  const target = adminSourcesTarget({ focus: '东鹏 & 饮料', next: '/?x=1' });
  assert.equal(new URL(target, 'http://localhost').searchParams.get('focus'), '东鹏 & 饮料');
  assert.equal(new URL(target, 'http://localhost').searchParams.get('next'), '/?x=1');
});

test('all historical entries use shared query-preserving redirect, not duplicate console pages', async () => {
  for (const file of ['app/admin/page.tsx', 'app/admin/crawl/page.tsx', 'app/sources/page.tsx',
    'app/crawl/page.tsx', 'app/ops/page.tsx', 'app/system/page.tsx']) {
    assert.match(await source(file), /redirect\(adminSourcesTarget\(await searchParams\)\)/, file);
  }
});

test('all six console pages use common width and have no login/logout/session gates', async () => {
  for (const file of ['sources/sources-admin-client', 'metrics/metrics-client', 'check/check-client',
    'audit/audit-admin-client', 'survey/survey-client', 'feedback/feedback-client']) {
    const text = await source(`app/admin/${file}.tsx`);
    assert.match(text, /<AdminMain>/, file);
    assert.doesNotMatch(text, /useAdminSession|AdminLoginForm|session\.|onLogout|showLogout/, file);
  }
  const css = await source('app/crawl/crawl-overview.css');
  assert.match(css, /\.co-shell-embedded \.co-page\{width:100%;max-width:none;margin:0;padding:0 0 24px\}/);
  const shell = await source('app/admin/_components/admin-shell.tsx');
  assert.match(shell, /数据管理/);
  assert.match(shell, /用户运营/);
  assert.match(shell, /aria-current=\{item.href === activeHref \? 'page' : undefined\}/);
  assert.match(shell, /height: 32/);
  assert.match(shell, /color: '#fff', borderColor: '#3064db', background: '#3064db'/);
  assert.doesNotMatch(shell, /AdminLoginForm|useAdminSession|退出|onLogout/);
  assert.doesNotMatch(await source('app/admin/sources/sources-admin-client.tsx'), /subtitle=|1600|发现 → 下载/);
});

test('normal console APIs have no admin cookie gate, including survey edits and AI summarize', async () => {
  for (const file of ['audit', 'feedback', 'survey', 'summarize', 'metrics', 'check',
    'metrics/ack', 'metrics/flag', 'reports/[id]/review']) {
    assert.doesNotMatch(await source(`app/api/admin/${file}/route.ts`), /\b(?:requireAdmin|isAdmin|validAdminPassword)\b/, file);
  }
});

test('delete password stays server-side, and is not imported into either browser delete UI', async () => {
  const route = await source('app/api/crawl/discard/route.ts');
  assert.match(route, /if \(!matchesDiscardPassword\(body.password\)\)/);
  assert.ok(route.indexOf('matchesDiscardPassword(body.password)') < route.indexOf('await discardAnnouncement('));
  for (const file of ['app/admin/metrics/metrics-client.tsx', 'app/crawl/crawl-overview.tsx']) {
    const text = await source(file);
    assert.doesNotMatch(text, /DISCARD_CONFIRM_PASSWORD|from ['"].*discard-password/);
    assert.match(text, /type="password"/);
    assert.match(text, /password/);
  }
});

test('actual delete handler rejects missing and wrong password before any database mutation', async () => {
  const { POST } = await import('../app/api/crawl/discard/route');
  for (const payload of [{ announcementId: 'not-a-real-id' }, { announcementId: 'not-a-real-id', password: 'wrong-test-value' }]) {
    const response = await POST(new Request('http://localhost/api/crawl/discard', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    assert.equal(response.status, 403);
  }
});

test('anonymous normal writes reach payload validation rather than a session 401', async () => {
  const { POST: ack } = await import('../app/api/admin/metrics/ack/route');
  const { POST: flag } = await import('../app/api/admin/metrics/flag/route');
  const { POST: review } = await import('../app/api/admin/reports/[id]/review/route');
  for (const handler of [ack, flag]) {
    const response = await handler(new Request('http://localhost/api/admin/test', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 400);
  }
  const response = await review(new Request('http://localhost/api/admin/reports/test/review', { method: 'POST', body: '{}' }),
    { params: Promise.resolve({ id: 'not-a-real-id' }) });
  assert.equal(response.status, 400);
});
