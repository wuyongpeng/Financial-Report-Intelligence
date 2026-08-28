import { adminCookieHeader, createAdminCookie, validAdminPassword } from '@/lib/auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { password?: string };
  if (!body.password || !validAdminPassword(body.password)) return Response.json({ error: '账号或密码错误' }, { status: 401 });
  return Response.json({ ok: true, role: 'admin' }, { headers: { 'set-cookie': adminCookieHeader(createAdminCookie()), 'cache-control': 'no-store' } });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { 'set-cookie': adminCookieHeader('', new Date(0)) } });
}
