import assert from 'node:assert/strict';
import test from 'node:test';
import { appUserRole, createDemoCookie, demoAccessEnabled } from '../lib/auth';

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
