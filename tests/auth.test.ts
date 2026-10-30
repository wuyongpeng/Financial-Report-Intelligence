import assert from 'node:assert/strict';
import test from 'node:test';
import { appUserRole, authorizeProductWrite, createDemoCookie, demoAccessEnabled, ensureConversationOwner, ensureGuestSession, requireAdmin, validAdminPassword } from '../lib/auth';

test('legacy demo cookie only validates while APP_DEMO_ACCESS is true', () => {
  const previousAccess = process.env.APP_DEMO_ACCESS;
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_DEMO_ACCESS = 'true';
  process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-24-characters';
  const cookie = createDemoCookie();
  const request = new Request('http://localhost/api/reports', { headers: { cookie: `fri_app_session=${cookie}` } });
  assert.equal(demoAccessEnabled(), true);
  assert.equal(appUserRole(request), 'guest');
  process.env.APP_DEMO_ACCESS = 'false';
  assert.equal(appUserRole(request), null);
  if (previousAccess === undefined) delete process.env.APP_DEMO_ACCESS; else process.env.APP_DEMO_ACCESS = previousAccess;
  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previousSecret;
});

test('anonymous guest session is stable across requests with the same cookie', () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-24-characters';
  const first = ensureGuestSession(new Request('http://localhost/'));
  assert.ok(first.setCookie);
  const cookie = first.setCookie.split(';')[0];
  const second = ensureConversationOwner(new Request('http://localhost/', { headers: { cookie } }));
  assert.equal(second.owner, first.owner);
  assert.equal(second.setCookie, undefined);
  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previousSecret;
});

test('guest Set-Cookie omits Secure unless COOKIE_SECURE=true', () => {
  const previousSecret = process.env.APP_SESSION_SECRET;
  const previousSecure = process.env.COOKIE_SECURE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.APP_SESSION_SECRET = 'test-session-secret-at-least-24-characters';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  delete process.env.COOKIE_SECURE;
  const withoutFlag = ensureGuestSession(new Request('http://10.0.0.1/'));
  assert.ok(withoutFlag.setCookie);
  assert.equal(/;\s*Secure(?:;|$)/i.test(withoutFlag.setCookie!), false);

  process.env.COOKIE_SECURE = 'false';
  const explicitFalse = ensureGuestSession(new Request('http://10.0.0.1/'));
  assert.ok(explicitFalse.setCookie);
  assert.equal(/;\s*Secure(?:;|$)/i.test(explicitFalse.setCookie!), false);

  process.env.COOKIE_SECURE = 'true';
  const explicitTrue = ensureGuestSession(new Request('https://example.com/'));
  assert.ok(explicitTrue.setCookie);
  assert.match(explicitTrue.setCookie!, /;\s*Secure(?:;|$)/i);

  if (previousSecret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previousSecret;
  if (previousSecure === undefined) delete process.env.COOKIE_SECURE; else process.env.COOKIE_SECURE = previousSecure;
  if (previousNodeEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV; else (process.env as Record<string, string | undefined>).NODE_ENV = previousNodeEnv;
});

test('validAdminPassword accepts built-in EVA and optional env password', () => {
  const previous = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  assert.equal(validAdminPassword('EVA'), true);
  assert.equal(validAdminPassword('eva'), false);
  assert.equal(validAdminPassword('wrong'), false);
  process.env.ADMIN_PASSWORD = 'custom-admin-pass';
  assert.equal(validAdminPassword('EVA'), true);
  assert.equal(validAdminPassword('custom-admin-pass'), true);
  assert.equal(validAdminPassword('nope'), false);
  if (previous === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous;
});

test('authorizeProductWrite stays open for anonymous product mutations even when APP_DEMO_ACCESS is false', () => {
  const previousAccess = process.env.APP_DEMO_ACCESS;
  const previousToken = process.env.INTERNAL_INGEST_TOKEN;
  process.env.APP_DEMO_ACCESS = 'false';
  delete process.env.INTERNAL_INGEST_TOKEN;
  assert.equal(authorizeProductWrite(new Request('http://localhost/api/companies/watch', { method: 'POST' })), 'public');
  process.env.INTERNAL_INGEST_TOKEN = 'ingest-token-for-tests-only';
  const withBearer = new Request('http://localhost/api/crawl/verdict-queue', {
    method: 'POST',
    headers: { authorization: 'Bearer ingest-token-for-tests-only' },
  });
  assert.equal(authorizeProductWrite(withBearer), 'token');
  if (previousAccess === undefined) delete process.env.APP_DEMO_ACCESS; else process.env.APP_DEMO_ACCESS = previousAccess;
  if (previousToken === undefined) delete process.env.INTERNAL_INGEST_TOKEN; else process.env.INTERNAL_INGEST_TOKEN = previousToken;
});

test('requireAdmin still rejects anonymous requests', () => {
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  process.env.ADMIN_SESSION_SECRET = 'test-admin-secret-at-least-24-chars';
  const denied = requireAdmin(new Request('http://localhost/api/admin/audit'));
  assert.ok(denied);
  assert.equal(denied!.status, 401);
  if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = previousSecret;
});
