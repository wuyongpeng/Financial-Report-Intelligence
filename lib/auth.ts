import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const cookieName = 'fri_admin_session';
const appCookieName = 'fri_app_session';
const maxAgeSeconds = 8 * 60 * 60;

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 24) throw new Error('ADMIN_SESSION_SECRET must be at least 24 characters');
  return value;
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function appSecret() {
  const value = process.env.APP_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 24) throw new Error('APP_SESSION_SECRET must be at least 24 characters');
  return value;
}

function signApp(payload: string) {
  return createHmac('sha256', appSecret()).update(payload).digest('base64url');
}

function cookieValue(request: Request) {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

function namedCookieValue(request: Request, name: string) {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
}

function safeEqual(leftValue: string, rightValue: string) {
  const left = Buffer.from(leftValue);
  const right = Buffer.from(rightValue);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validAdminPassword(candidate: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return safeEqual(candidate, expected);
}

export function validAppCredentials(username: string, password: string) {
  const expectedUsername = process.env.APP_USERNAME;
  const expectedPassword = process.env.APP_PASSWORD;
  return Boolean(expectedUsername && expectedPassword && safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword));
}

export function createAppCookie(username: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const encodedUsername = Buffer.from(username).toString('base64url');
  const payload = `user.${encodedUsername}.${expiresAt}.${randomUUID()}`;
  return `${payload}.${signApp(payload)}`;
}

export function demoAccessEnabled() {
  return process.env.APP_DEMO_ACCESS === 'true';
}

export function createDemoCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = `guest.demo.${expiresAt}.${randomUUID()}`;
  return `${payload}.${signApp(payload)}`;
}

export function appUserRole(request: Request): 'user' | 'guest' | null {
  const value = namedCookieValue(request, appCookieName);
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [role, encodedUsername, expiresAt] = parts;
  const signature = parts.at(-1)!;
  if (!encodedUsername || !/^\d+$/.test(expiresAt) || !signature || Number(expiresAt) <= Math.floor(Date.now() / 1000)) return null;
  const payload = parts.slice(0, -1).join('.');
  try { if (!safeEqual(signature, signApp(payload))) return null; } catch { return null; }
  if (role === 'guest') return encodedUsername === 'demo' && demoAccessEnabled() ? 'guest' : null;
  if (role !== 'user') return null;
  const expectedUsername = process.env.APP_USERNAME;
  const username = Buffer.from(encodedUsername, 'base64url').toString();
  return expectedUsername && safeEqual(username, expectedUsername) ? 'user' : null;
}

// Private conversations belong to one signed browser login session. Legacy
// cookies remain valid for reading but must be refreshed before enabling memory.
export function appSessionOwner(request: Request) {
  if (!appUserRole(request)) return null;
  const value = namedCookieValue(request, appCookieName)!;
  if (value.split('.').length !== 5) return null;
  return createHmac('sha256', appSecret()).update(`conversation:${value}`).digest('hex');
}

export function isAppUser(request: Request) {
  return appUserRole(request) !== null;
}

export function createAdminCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = `admin.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function isAdmin(request: Request) {
  const value = cookieValue(request);
  if (!value) return false;
  const [role, expiresAt, signature] = value.split('.');
  if (role !== 'admin' || !expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) return false;
  const payload = `${role}.${expiresAt}`;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function adminCookieHeader(value: string, expires?: Date) {
  // IP + HTTP verification cannot persist a Secure cookie. Keep the production
  // default, but allow the VM bootstrap environment to opt out explicitly.
  const secureCookie = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  const secure = secureCookie ? '; Secure' : '';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : maxAgeSeconds}${secure}`;
}

export function appCookieHeader(value: string, expires?: Date) {
  const secureCookie = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  const secure = secureCookie ? '; Secure' : '';
  return `${appCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : maxAgeSeconds}${secure}`;
}


const guestCookieName = 'fri_guest_session';
const guestMaxAgeSeconds = 30 * 24 * 60 * 60;

function guestSecret() {
  return appSecret();
}

function signGuest(payload: string) {
  return createHmac('sha256', guestSecret()).update(payload).digest('base64url');
}

/** Mint or read an anonymous guest cookie for conversation isolation (no login). */
export function ensureGuestSession(request: Request): { owner: string; setCookie?: string } {
  const existing = namedCookieValue(request, guestCookieName);
  if (existing) {
    const parts = existing.split('.');
    if (parts.length === 3) {
      const [id, expiresAt, signature] = parts;
      const payload = `${id}.${expiresAt}`;
      try {
        if (id && /^\d+$/.test(expiresAt) && Number(expiresAt) > Math.floor(Date.now() / 1000)
          && safeEqual(signature, signGuest(payload))) {
          return { owner: createHmac('sha256', guestSecret()).update(`conversation:guest:${id}`).digest('hex') };
        }
      } catch { /* mint new */ }
    }
  }
  const id = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + guestMaxAgeSeconds;
  const payload = `${id}.${expiresAt}`;
  const value = `${payload}.${signGuest(payload)}`;
  const secureCookie = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';
  const secure = secureCookie ? '; Secure' : '';
  return {
    owner: createHmac('sha256', guestSecret()).update(`conversation:guest:${id}`).digest('hex'),
    setCookie: `${guestCookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${guestMaxAgeSeconds}${secure}`,
  };
}

/** Logged-in / demo app session first; otherwise anonymous guest owner. */
export function hasGuestSession(request: Request) {
  const existing = namedCookieValue(request, guestCookieName);
  if (!existing) return false;
  const parts = existing.split('.');
  if (parts.length !== 3) return false;
  const [id, expiresAt, signature] = parts;
  const payload = `${id}.${expiresAt}`;
  try {
    return Boolean(id && /^\d+$/.test(expiresAt) && Number(expiresAt) > Math.floor(Date.now() / 1000)
      && safeEqual(signature, signGuest(payload)));
  } catch { return false; }
}

export function ensureConversationOwner(request: Request): { owner: string; setCookie?: string } {
  const session = appSessionOwner(request);
  if (session) return { owner: session };
  return ensureGuestSession(request);
}

export function requireAppUser(request: Request) {
  if (!isAppUser(request)) return Response.json({ error: '请先登录' }, { status: 401 });
  return null;
}

export function requireAdmin(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: '管理员登录已失效' }, { status: 401 });
  return null;
}
