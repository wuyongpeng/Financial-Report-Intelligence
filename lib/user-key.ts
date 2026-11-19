import { appSessionUsername } from './auth';

/** Stable per registered account. Shared env login uses the same key. */
export function registeredUserKey(request: Request) {
  const username = appSessionUsername(request);
  return username ? username.trim().toLowerCase() : null;
}

export function userKeyFromUsername(username: string) {
  return username.trim().toLowerCase();
}

export function loginRequired() {
  return Response.json({ error: '请先登录', code: 'login_required' }, { status: 401, headers: { 'cache-control': 'no-store' } });
}

export function jsonOk(body: unknown, status = 200, setCookie?: string) {
  const headers = new Headers({ 'cache-control': 'no-store', 'content-type': 'application/json' });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(JSON.stringify(body), { status, headers });
}
