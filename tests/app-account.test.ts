import assert from 'node:assert/strict';
import test from 'node:test';
import { appCookieHeader, appSessionOwner, appSessionUsername, appUserRole, createAppCookie } from '../lib/auth';
import {
  GUEST_DAILY_ASK_LIMIT,
  REGISTERED_ASK_LIMIT,
  SUGGEST_REGISTER_AFTER,
  hashPassword,
  isUnlimitedUsername,
  parseUnlimitedTokenUsers,
  shanghaiDate,
  shouldSuggestRegister,
  validatePassword,
  validateUsername,
  verifyPassword,
} from '../lib/app-account';

test('guest and registered conversation limits match the product rules', () => {
  assert.equal(GUEST_DAILY_ASK_LIMIT, 9);
  assert.equal(REGISTERED_ASK_LIMIT, 100);
  assert.equal(SUGGEST_REGISTER_AFTER, 3);
  assert.equal(shouldSuggestRegister('guest', 3), false);
  assert.equal(shouldSuggestRegister('guest', 4), true);
  assert.equal(shouldSuggestRegister('user', 4), false);
});

test('UNLIMITED_TOKEN_USERS parses comma-separated names case-insensitively', () => {
  const names = parseUnlimitedTokenUsers('Alice, bob, ,Carol');
  assert.deepEqual([...names].sort(), ['alice', 'bob', 'carol']);
  assert.equal(isUnlimitedUsername('ALICE', 'Alice,bob'), true);
  assert.equal(isUnlimitedUsername('dave', 'Alice,bob'), false);
  assert.equal(isUnlimitedUsername('alice', ''), false);
});

test('username and password validation reject empty or illegal values', () => {
  assert.equal(validateUsername('ab'), null);
  assert.equal(validateUsername('测试用户'), null);
  assert.ok(validateUsername('a'));
  assert.ok(validateUsername('has space'));
  assert.ok(validateUsername('bad/name'));
  assert.equal(validatePassword('abcdef'), null);
  assert.ok(validatePassword('12345'));
});

test('password hashes can be verified and do not match a wrong password', async () => {
  const stored = await hashPassword('correct-password');
  assert.equal(await verifyPassword('correct-password', stored), true);
  assert.equal(await verifyPassword('wrong-password', stored), false);
});

test('shanghaiDate returns a YYYY-MM-DD calendar date', () => {
  assert.match(shanghaiDate(new Date('2026-11-19T16:00:00.000Z')), /^\d{4}-\d{2}-\d{2}$/);
});

test('a signed app cookie is accepted for any registered username', () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  const previousUser = process.env.APP_USERNAME;
  process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-24-characters';
  delete process.env.APP_USERNAME;
  const cookie = createAppCookie('演示用户');
  const request = new Request('http://localhost/api/auth/session', { headers: { cookie: appCookieHeader(cookie) } });
  assert.equal(appUserRole(request), 'user');
  assert.equal(appSessionUsername(request), '演示用户');
  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previousSecret;
  if (previousUser === undefined) delete process.env.APP_USERNAME; else process.env.APP_USERNAME = previousUser;
});

test('a unique registered account keeps the same conversation owner across logins', () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  const previousUser = process.env.APP_USERNAME;
  process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-24-characters';
  process.env.APP_USERNAME = 'tester';
  const request = (name: string) => new Request('http://localhost', { headers: { cookie: `fri_app_session=${createAppCookie(name)}` } });
  const first = appSessionOwner(request('alice'));
  const second = appSessionOwner(request('alice'));
  const other = appSessionOwner(request('bob'));
  assert.ok(first);
  assert.equal(first, second);
  assert.notEqual(first, other);
  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previousSecret;
  if (previousUser === undefined) delete process.env.APP_USERNAME; else process.env.APP_USERNAME = previousUser;
});
