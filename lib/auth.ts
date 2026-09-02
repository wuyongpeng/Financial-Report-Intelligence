import { createHmac, timingSafeEqual } from 'node:crypto';

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
  const payload = `user.${encodedUsername}.${expiresAt}`;
  return `${payload}.${signApp(payload)}`;
}

export function demoAccessEnabled() {
  return process.env.APP_DEMO_ACCESS === 'true';
}

export function createDemoCookie() {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = `guest.demo.${expiresAt}`;
  return `${payload}.${signApp(payload)}`;
}

export function appUserRole(request: Request): 'user' | 'guest' | null {
  const value = namedCookieValue(request, appCookieName);
  if (!value) return null;
  const [role, encodedUsername, expiresAt, signature] = value.split('.');
  if (!encodedUsername || !expiresAt || !signature || Number(expiresAt) < Math.floor(Date.now() / 1000)) return null;
  const payload = `${role}.${encodedUsername}.${expiresAt}`;
  if (!safeEqual(signature, signApp(payload))) return null;
  if (role === 'guest') return encodedUsername === 'demo' && demoAccessEnabled() ? 'guest' : null;
  if (role !== 'user') return null;
  const expectedUsername = process.env.APP_USERNAME;
  const username = Buffer.from(encodedUsername, 'base64url').toString();
  return expectedUsername && safeEqual(username, expectedUsername) ? 'user' : null;
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

export function requireAppUser(request: Request) {
  if (!isAppUser(request)) return Response.json({ error: '请先登录' }, { status: 401 });
  return null;
}

export function requireAdmin(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: '管理员登录已失效' }, { status: 401 });
  return null;
}
