import assert from 'node:assert/strict';
import test from 'node:test';
import { appUserRole, createDemoCookie, demoAccessEnabled, ensureConversationOwner, ensureGuestSession } from '../lib/auth';

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
  process.env.NODE_ENV = 'production';
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
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
});

