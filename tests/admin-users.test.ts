import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createAdminCookie } from '../lib/auth';
import {
  accountIsUnlimited,
  canClearDbUnlimited,
  countAdminUsers,
  filterAdminUsers,
  isQuotaFull,
  parseQuotaLimit,
  quotaLabel,
  statusLabel,
  unlimitedSource,
  type AdminUserRecord,
} from '../lib/admin-users';
import {
  ACCOUNT_DISABLED_MESSAGE,
  DEFAULT_USER_QUOTA,
  GUEST_DAILY_ASK_LIMIT,
  generateTemporaryPassword,
} from '../lib/app-account';

const source = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

function user(partial: Partial<AdminUserRecord> & Pick<AdminUserRecord, 'id' | 'username'>): AdminUserRecord {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    askCount: 0,
    quotaLimit: 100,
    unlimited: false,
    unlimitedSource: null,
    disabledAt: null,
    lastAskAt: null,
    ...partial,
  };
}

test('ops nav puts 账号管理 first in 用户运营 and the page uses shared chrome', async () => {
  const shell = await source('app/admin/_components/admin-shell.tsx');
  const userGroup = shell.slice(shell.indexOf("id: 'user'"));
  assert.match(userGroup, /href: '\/admin\/users', label: '账号管理'/);
  assert.ok(userGroup.indexOf("/admin/users") < userGroup.indexOf("/admin/audit"));
  assert.ok(userGroup.indexOf("/admin/audit") < userGroup.indexOf("/admin/survey"));
  const page = await source('app/admin/users/page.tsx');
  const client = await source('app/admin/users/users-admin-client.tsx');
  assert.match(page, /UsersAdminClient/);
  assert.match(client, /<AdminMain>/);
  assert.match(client, /<AdminHeader title="账号管理" activeHref="\/admin\/users"/);
  assert.doesNotMatch(client, /<h1>/);
  assert.match(client, /placeholder="快速检索"/);
  assert.match(client, /全部/);
  assert.match(client, /额度已满/);
  assert.match(client, /已停用/);
  assert.match(client, /cardCompact/);
  assert.match(client, /调整额度/);
  assert.match(client, /设为不限次数/);
  assert.match(client, /取消不限/);
  assert.match(client, /停用/);
  assert.match(client, /重置密码/);
  assert.match(client, /temporaryPassword/);
  assert.match(client, /关闭后将不再显示/);
  assert.doesNotMatch(client, /console\.log/);
});

test('list helpers search by username and filter full or disabled accounts', () => {
  const items = [
    user({ id: '11111111-1111-4111-8111-111111111111', username: 'alice', askCount: 87, quotaLimit: 100 }),
    user({ id: '22222222-2222-4222-8222-222222222222', username: 'bob', askCount: 100, quotaLimit: 100 }),
    user({
      id: '33333333-3333-4333-8333-333333333333',
      username: 'carol',
      askCount: 200,
      quotaLimit: 100,
      unlimited: true,
      unlimitedSource: 'db',
    }),
    user({
      id: '44444444-4444-4444-8444-444444444444',
      username: 'dave',
      askCount: 10,
      quotaLimit: 100,
      disabledAt: '2026-02-01T00:00:00.000Z',
    }),
  ];
  assert.equal(quotaLabel(items[0]), '87 / 100');
  assert.equal(quotaLabel(items[2]), '对话次数不限');
  assert.equal(statusLabel(null), '正常');
  assert.equal(statusLabel(items[3].disabledAt), '已停用');
  assert.equal(isQuotaFull(items[1]), true);
  assert.equal(isQuotaFull(items[2]), false);
  const counts = countAdminUsers(items);
  assert.deepEqual(counts, { all: 4, quotaFull: 1, disabled: 1 });
  assert.deepEqual(filterAdminUsers(items, 'all', 'ali').map((row) => row.username), ['alice']);
  assert.deepEqual(filterAdminUsers(items, 'quota_full', '').map((row) => row.username), ['bob']);
  assert.deepEqual(filterAdminUsers(items, 'disabled', '').map((row) => row.username), ['dave']);
});

test('quota parsing and unlimited source treat env and database flags independently', () => {
  assert.equal(parseQuotaLimit(200), 200);
  assert.equal(parseQuotaLimit('15'), 15);
  assert.throws(() => parseQuotaLimit(0), /正整数/);
  assert.throws(() => parseQuotaLimit(-3), /正整数/);
  assert.throws(() => parseQuotaLimit(1.5), /正整数/);
  assert.equal(unlimitedSource(true, false), 'env');
  assert.equal(unlimitedSource(false, true), 'db');
  assert.equal(unlimitedSource(true, true), 'both');
  assert.equal(unlimitedSource(false, false), null);
  assert.equal(accountIsUnlimited(true, false), true);
  assert.equal(accountIsUnlimited(false, true), true);
  assert.equal(accountIsUnlimited(false, false), false);
  assert.equal(canClearDbUnlimited('env'), false);
  assert.equal(canClearDbUnlimited('db'), true);
  assert.equal(canClearDbUnlimited('both'), true);
  assert.equal(DEFAULT_USER_QUOTA, 100);
  assert.equal(GUEST_DAILY_ASK_LIMIT, 9);
});

test('temporary password generator uses a safe alphabet and does not log values', async () => {
  const alphabet = /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{12}$/;
  const first = generateTemporaryPassword();
  const second = generateTemporaryPassword();
  assert.match(first, alphabet);
  assert.match(second, alphabet);
  assert.notEqual(first, second);
  const api = await source('app/api/admin/users/route.ts');
  const client = await source('app/admin/users/users-admin-client.tsx');
  assert.match(api, /action === 'reset_password'/);
  assert.match(api, /generateTemporaryPassword/);
  assert.match(api, /hashPassword/);
  assert.match(api, /temporaryPassword/);
  assert.doesNotMatch(api, /console\.(log|info|debug|warn)/);
  assert.doesNotMatch(client, /console\.(log|info|debug|warn)/);
  assert.doesNotMatch(api, /DISCARD_CONFIRM_PASSWORD/);
  assert.doesNotMatch(client, /DISCARD_CONFIRM_PASSWORD/);
});

test('login and ask paths honor disabled accounts and database or env unlimited flags', async () => {
  const account = await source('lib/app-account.ts');
  const schema = await source('lib/backend-schema.ts');
  const login = await source('app/api/auth/login/route.ts');
  assert.match(account, /export class AccountDisabledError/);
  assert.match(account, /ACCOUNT_DISABLED_MESSAGE/);
  assert.equal(ACCOUNT_DISABLED_MESSAGE, '该账号已停用，如需恢复请联系管理员。');
  assert.match(account, /isDisabledAccount\(account\.disabled_at\)/);
  assert.match(account, /isUnlimitedUsername\(username\) \|\| Boolean\(account\?\.unlimited\)/);
  assert.match(account, /if \(isDisabledAccount\(row\.disabled_at\)\) throw new AccountDisabledError/);
  assert.match(login, /authenticateAccount/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS unlimited BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS email TEXT/);
  assert.match(schema, /ADD COLUMN IF NOT EXISTS email_notify/);
  assert.doesNotMatch(schema, /DROP COLUMN.*email/);
  const peek = account.slice(account.indexOf('export async function peekAskQuota'));
  const consume = account.slice(account.indexOf('export async function consumeAskQuota'));
  assert.match(peek, /loadUserQuota/);
  assert.match(consume, /loadUserQuota/);
});

test('admin user APIs require an admin session and reject invalid writes before touching the database', async () => {
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-at-least-24-chars';
  const { GET, PATCH } = await import('../app/api/admin/users/route');
  const deniedGet = await GET(new Request('http://localhost/api/admin/users'));
  assert.equal(deniedGet.status, 401);
  const deniedPatch = await PATCH(new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', action: 'set_quota', quotaLimit: 200 }),
  }));
  assert.equal(deniedPatch.status, 401);

  const cookie = `fri_admin_session=${createAdminCookie()}`;
  const invalid = await PATCH(new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', action: 'set_quota', quotaLimit: 0 }),
  }));
  assert.equal(invalid.status, 400);
  const unknown = await PATCH(new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', action: 'invite' }),
  }));
  assert.equal(unknown.status, 400);
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
  else process.env.ADMIN_SESSION_SECRET = previousSecret;
});
