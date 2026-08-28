import { createHmac, timingSafeEqual } from 'node:crypto';

const cookieName = 'fri_admin_session';
const maxAgeSeconds = 8 * 60 * 60;

function secret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < 24) throw new Error('ADMIN_SESSION_SECRET must be at least 24 characters');
  return value;
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function cookieValue(request: Request) {
  const header = request.headers.get('cookie') ?? '';
  return header.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

export function validAdminPassword(candidate: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expires ? 0 : maxAgeSeconds}${secure}`;
}

export function requireAdmin(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: '管理员登录已失效' }, { status: 401 });
  return null;
}
